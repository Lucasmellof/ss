package main

import (
	"context"
	"errors"
	"flag"
	"io"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"github.com/pion/webrtc/v4"

	"screen-share/web"
)

func main() {
	cfg := config{}
	flag.StringVar(&cfg.addr, "addr", envOr("ADDR", ":8080"), "endereço HTTP, por exemplo :8080")
	flag.StringVar(&cfg.publicIP, "public-ip", envOr("PUBLIC_IP", ""), "IP público anunciado pelo ICE (opcional)")
	flag.IntVar(&cfg.maxViewers, "max-viewers", envIntOr("MAX_VIEWERS", defaultMaxViewers), "máximo de espectadores por sala")
	flag.IntVar(&cfg.maxPublishers, "max-publishers", envIntOr("MAX_PUBLISHERS", defaultMaxPublishers), "máximo de transmissões simultâneas por sala")
	flag.IntVar(&cfg.wsRateLimit, "ws-rate-limit", envIntOr("WS_RATE_LIMIT", defaultWSRateLimit), "máximo de novas conexões WebSocket por IP por minuto")
	flag.IntVar(&cfg.maxWSPerIP, "max-ws-per-ip", envIntOr("MAX_WS_PER_IP", defaultMaxWSPerIP), "máximo de conexões WebSocket simultâneas por IP")
	flag.UintVar(&cfg.udpMin, "udp-min", envUintOr("UDP_MIN", defaultUDPMin), "menor porta UDP usada pelo ICE")
	flag.UintVar(&cfg.udpMax, "udp-max", envUintOr("UDP_MAX", defaultUDPMax), "maior porta UDP usada pelo ICE")
	flag.UintVar(&cfg.udpPort, "udp-port", envUintOr("UDP_PORT", 0), "single UDP port for all ICE traffic; overrides udp-min/udp-max when set")
	trustedProxies := flag.String("trusted-proxies", envOr("TRUSTED_PROXIES", ""), "comma-separated CIDRs or IPs of reverse proxies allowed to set X-Forwarded-For/X-Real-IP")
	flag.Parse()

	if cfg.maxViewers < 1 || cfg.maxPublishers < 1 || cfg.wsRateLimit < 1 || cfg.maxWSPerIP < 1 {
		log.Fatal("max-viewers, max-publishers, ws-rate-limit e max-ws-per-ip precisam ser maiores que zero")
	}
	if cfg.udpMin > 65535 || cfg.udpMax > 65535 || (cfg.udpMin == 0) != (cfg.udpMax == 0) || (cfg.udpMin > 0 && cfg.udpMin > cfg.udpMax) {
		log.Fatal("udp-min e udp-max precisam formar uma faixa válida entre 1 e 65535")
	}

	if err := validateUDPPort(cfg.udpPort); err != nil {
		log.Fatal(err)
	}
	proxies, err := parseTrustedProxies(*trustedProxies)
	if err != nil {
		log.Fatal(err)
	}
	cfg.trustedProxies = proxies

	var api *webrtc.API
	var udpMux io.Closer
	if cfg.udpPort > 0 {
		api, udpMux, err = newMuxedWebRTCAPI(cfg.publicIP, cfg.udpPort)
	} else {
		api, err = newWebRTCAPI(cfg.publicIP, cfg.udpMin, cfg.udpMax)
	}
	if err != nil {
		log.Fatalf("configuração ICE inválida: %v", err)
	}
	s := &server{
		cfg:     cfg,
		api:     api,
		rooms:   &roomManager{rooms: make(map[string]*room)},
		limiter: newIPRateLimiter(cfg.wsRateLimit, cfg.maxWSPerIP),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", s.handleWebSocket)
	mux.HandleFunc("/healthz", healthHandler)
	mux.Handle("/", securityHeaders(http.FileServer(http.FS(web.FS))))

	httpServer := &http.Server{
		Addr:              cfg.addr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}

	log.Printf("screen-share ouvindo em %s", cfg.addr)
	if cfg.publicIP != "" {
		log.Printf("ICE anunciando PUBLIC_IP=%s", cfg.publicIP)
	}
	if cfg.udpPort > 0 {
		log.Printf("ICE using single UDP port %d", cfg.udpPort)
	} else {
		log.Printf("ICE usando UDP %d-%d", cfg.udpMin, cfg.udpMax)
	}
	if len(cfg.trustedProxies) > 0 {
		log.Printf("trusting forwarded headers from %d proxy networks", len(cfg.trustedProxies))
	}
	log.Printf("limite WebSocket: %d tentativas/minuto e %d conexões/IP", cfg.wsRateLimit, cfg.maxWSPerIP)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	serveErr := make(chan error, 1)
	go func() {
		serveErr <- httpServer.ListenAndServe()
	}()

	select {
	case err := <-serveErr:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	case <-ctx.Done():
		stop()
		log.Printf("shutting down")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := httpServer.Shutdown(shutdownCtx); err != nil {
			log.Printf("http shutdown: %v", err)
		}
	}
	if udpMux != nil {
		_ = udpMux.Close()
	}
}
