# Deploying Screen Share on Kubernetes

The relay is a single Go binary that serves the web UI and the WebSocket signaling over HTTP and relays WebRTC media over UDP. Two things matter on Kubernetes:

1. **One replica.** Rooms live in the memory of one process, so publishers and viewers of a room must reach the same pod. The chart and the manifests use `replicas: 1` with the `Recreate` strategy; an upgrade restarts the pod and drops active sessions (clients reconnect).
2. **UDP must be reachable from clients** at the address advertised in `PUBLIC_IP`, on the **same port number** the relay listens on. Ingress controllers only proxy HTTP, so media needs its own path into the cluster. That is what the media modes below are for.

Browsers only allow screen capture over HTTPS (or `localhost`), so put the HTTP side behind an Ingress with TLS.

## Quick start with Helm

Requirements: an ingress controller (the defaults target [ingress-nginx](https://kubernetes.github.io/ingress-nginx/)) and [cert-manager](https://cert-manager.io/) with a `ClusterIssuer` named `letsencrypt-prod`, and nodes with public IPs.

```bash
git clone https://github.com/SwloBr/ss && cd ss
helm install ss ./deploy/helm/ss --namespace ss --create-namespace \
  --set ingress.enabled=true --set ingress.host=share.example.com
kubectl -n ss rollout status deploy/ss
```

Point `share.example.com` at your ingress controller, open UDP `40000-40100` on the node firewall, and open `https://share.example.com/`.

Image: `ghcr.io/swlobr/ss` (`linux/amd64`, `linux/arm64`). Tags: `latest` (main branch), `sha-<short>`, and `X.Y.Z` / `X.Y` for `vX.Y.Z` releases. Pin a tag with `--set image.tag=1.2.3` and `--set image.pullPolicy=IfNotPresent`.

## Choosing a media mode

Set `media.mode` to one of:

| Mode | How UDP reaches the pod | Ports to open | `PUBLIC_IP` | Use it when |
| --- | --- | --- | --- | --- |
| `hostNetwork` (default) | The pod shares the node network namespace; ICE uses the range `media.udpMin`-`media.udpMax`. | UDP `40000-40100` on the node | `publicIP`, or the node IP (`status.hostIP`) when `publicIP` is empty | Nodes have public IPs (single VPS, k3s, bare metal). Simplest option. |
| `hostPort` | One UDP port (`media.udpPort`, via `UDP_PORT`) mapped with `hostPort` on the node running the pod. | UDP `40000` on the node | `publicIP`, or the node IP | You prefer not to use `hostNetwork` but nodes are still reachable. Requires a CNI with the portmap plugin (the default on most distributions). |
| `loadBalancer` | One UDP port behind a `Service` of type `LoadBalancer` with `externalTrafficPolicy: Local`. | Handled by the cloud load balancer | Must be set to the load balancer IP | Managed clusters whose nodes are private (EKS, GKE, AKS, DOKS, ...). |

Notes:

- In `hostNetwork` mode the pod also binds TCP `8080` on the node. Keep that port closed to the internet and reach the app through the Ingress.
- When nodes sit behind NAT (their `status.hostIP` is private), always set `publicIP` to the address clients can reach, and forward the UDP port(s) to the node with the same port numbers.
- To pin the relay to a specific public node, use `nodeSelector` (for example `--set nodeSelector."kubernetes\.io/hostname"=node-1`) and set `publicIP` to that node's address.

### LoadBalancer example

The load balancer address is not known until the Service exists, so install first and then set `publicIP`:

```bash
helm install ss ./deploy/helm/ss -n ss --create-namespace \
  --set media.mode=loadBalancer \
  --set ingress.enabled=true --set ingress.host=share.example.com
kubectl -n ss get svc ss-media -w
helm upgrade ss ./deploy/helm/ss -n ss --reuse-values --set publicIP=<EXTERNAL-IP>
```

If your cloud supports reserving a static IP, set both `media.loadBalancer.loadBalancerIP` (or the provider-specific annotation in `media.loadBalancer.annotations`) and `publicIP` up front. The advertised port is `media.udpPort`, so the Service port and the container port are always the same number.

## Firewall checklist

- TCP 80/443 to the ingress controller.
- UDP to the relay: `40000-40100` (`hostNetwork`) or `media.udpPort` (`hostPort`, `loadBalancer`).
- Nothing else needs to be public. The HTTP Service is `ClusterIP` on port 8080.
- Very restrictive networks that block UDP entirely need a TURN server, which this project does not ship.

## TLS

With `ingress.tls.enabled=true` (the default when the Ingress is enabled) the chart adds `cert-manager.io/cluster-issuer: <ingress.clusterIssuer>` and stores the certificate in `<fullname>-tls` (`ss-tls` for a release named `ss`) (override with `ingress.tls.secretName`). To use an existing certificate, create the secret yourself, set `ingress.tls.secretName`, and set `ingress.clusterIssuer=""`.

The default Ingress annotations raise the ingress-nginx proxy read/send timeouts to one hour so idle WebSockets are not cut. For other controllers, replace `ingress.annotations` and `ingress.className` with the equivalents (Traefik and Caddy keep WebSockets open by default).

## Client IPs and rate limiting

The relay rate-limits WebSocket connections per client IP. Behind an Ingress every request comes from the ingress pod, so the relay must trust that hop's `X-Forwarded-For` / `X-Real-IP` headers. `config.trustedProxies` (`TRUSTED_PROXIES`) defaults to the private ranges `10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,100.64.0.0/10`, which covers typical pod networks. Narrow it to your pod CIDR if clients on private networks can reach the relay directly. For ingress-nginx with a cloud load balancer, also enable `use-forwarded-headers` or the PROXY protocol so the controller sees real client addresses.

## Values reference

| Value | Default | Description |
| --- | --- | --- |
| `image.repository` | `ghcr.io/swlobr/ss` | Image |
| `image.tag` | chart `appVersion` (`latest`) | Image tag |
| `image.pullPolicy` | `Always` | Pull policy |
| `publicIP` | empty | IP advertised in ICE candidates (`PUBLIC_IP`) |
| `media.mode` | `hostNetwork` | `hostNetwork`, `hostPort` or `loadBalancer` |
| `media.udpMin` / `media.udpMax` | `40000` / `40100` | UDP range for `hostNetwork` |
| `media.udpPort` | `40000` | Single UDP port for `hostPort` and `loadBalancer` |
| `media.loadBalancer.*` | empty | `annotations`, `loadBalancerIP`, `loadBalancerSourceRanges` for the media Service |
| `config.maxViewers` | `20` | `MAX_VIEWERS` |
| `config.maxPublishers` | `4` | `MAX_PUBLISHERS` |
| `config.wsRateLimit` | `30` | `WS_RATE_LIMIT` |
| `config.maxWSPerIP` | `16` | `MAX_WS_PER_IP` |
| `config.trustedProxies` | private ranges | `TRUSTED_PROXIES` |
| `extraEnv` | `[]` | Extra container env entries |
| `service.port` | `8080` | HTTP Service port |
| `ingress.enabled` | `false` | Create an Ingress |
| `ingress.className` | `nginx` | Ingress class |
| `ingress.host` | empty | Host name (required when enabled) |
| `ingress.annotations` | ingress-nginx WebSocket timeouts | Ingress annotations |
| `ingress.clusterIssuer` | `letsencrypt-prod` | cert-manager ClusterIssuer; empty to disable |
| `ingress.tls.enabled` / `ingress.tls.secretName` | `true` / `<fullname>-tls` | TLS settings |
| `resources`, `nodeSelector`, `tolerations`, `affinity` | see `values.yaml` | Scheduling and resources |

## Plain manifests (kustomize)

`deploy/k8s` is a kustomize base equivalent to the chart in `hostNetwork` mode with an ingress-nginx Ingress. Edit `ingress.yaml` to replace `share.example.com`, then:

```bash
kubectl apply -k deploy/k8s
```

To advertise a fixed address instead of the node IP, change the `PUBLIC_IP` entry in `deployment.yaml` to `value: "<your public IP>"`, or add a patch in an overlay.
