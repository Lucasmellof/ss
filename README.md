# Screen Share

Servidor leve, self-hosted e escrito em Go para compartilhar tela e áudio do sistema pelo navegador. A VPS faz a sinalização e retransmite os pacotes WebRTC sem gravar ou recodificar o vídeo.

## Como usar localmente

```powershell
go run ./cmd/ss
```

Abra `http://localhost:8080`, escolha uma sala e clique em **Transmitir**. Para o áudio do PC, use uma versão atual do Chrome ou Edge, selecione a tela inteira e marque **Compartilhar áudio do sistema**.

Em outro navegador, abra a mesma URL, selecione **Assistir**, digite o mesmo nome de sala e entre.

## Deploy em VPS

O binário não precisa de banco de dados nem de arquivos externos:

```bash
go build -trimpath -ldflags='-s -w' -o screen-share ./cmd/ss
PUBLIC_IP='203.0.113.10' ./screen-share -addr 127.0.0.1:8080
```

Coloque Nginx, Caddy ou Traefik na frente para fornecer HTTPS e encaminhar:

* `https://seu-dominio/` para `127.0.0.1:8080`
* `wss://seu-dominio/ws` para `127.0.0.1:8080/ws`

Com Caddy, o arquivo [Caddyfile.example](Caddyfile.example) já contém o proxy mínimo; ele também cuida do certificado TLS e do upgrade WebSocket.

O HTTPS é necessário para o navegador permitir captura de tela fora de `localhost`. A porta HTTP pode ficar fechada para a internet. Além do HTTPS, libere **UDP 40000-40100** no firewall da VPS. Se o servidor estiver atrás de NAT — inclusive dentro do Docker — configure `PUBLIC_IP` com o endereço público real. Sem isso, a página abre mas o espectador fica aguardando a transmissão.

### Docker

Copie o arquivo de ambiente e preencha o IP público real da VPS; o [docker-compose.yml](docker-compose.yml) já publica a faixa UDP configurada:

```bash
cp .env.example .env
docker compose up -d --build
```

Para produção, use uma faixa UDP fixa no firewall e um proxy TLS na frente. O cliente usa STUN para atravessar NAT; redes muito restritivas podem exigir um servidor TURN.

## Variáveis e flags

| Variável | Flag | Padrão | Uso |
| --- | --- | --- | --- |
| `ADDR` | `-addr` | `:8080` | Endereço HTTP |
| `PUBLIC_IP` | `-public-ip` | vazio | IP público anunciado pelo ICE |
| `MAX_VIEWERS` | `-max-viewers` | `20` | Limite de espectadores por sala |
| `WS_RATE_LIMIT` | `-ws-rate-limit` | `30` | Novas conexões WebSocket por IP por minuto |
| `MAX_WS_PER_IP` | `-max-ws-per-ip` | `16` | Conexões WebSocket simultâneas por IP |
| `UDP_MIN` | `-udp-min` | `40000` | Primeiro porto da faixa ICE |
| `UDP_MAX` | `-udp-max` | `40100` | Último porto da faixa ICE |

O código de sala precisa ter entre 8 e 64 caracteres, usando letras, números, hífen ou sublinhado. O relay limita novas conexões WebSocket e conexões simultâneas por IP; atrás de um proxy local, ele usa o primeiro endereço válido de `X-Forwarded-For` ou `X-Real-IP`. O servidor mantém somente os pacotes em trânsito na memória; não há gravação. O código não é autenticação: qualquer pessoa que descubra um código ainda pode entrar. Para privacidade forte, o próximo passo é implementar autenticação ou convites assinados.

## Cliente desktop para amigos

Há um cliente Electrobun em [desktop/](desktop/README.md) para distribuir uma janela própria no Windows. Ele abre a sala da sua VPS e guarda localmente a URL e a sala usada. Para o caminho mais previsível, use o modo **Assistir**; o modo **Transmitir** depende da captura WebRTC do renderer CEF e deve ser validado nas máquinas que forem usar.
