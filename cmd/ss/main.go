package main

import (
	"errors"
	"flag"
	"log"
	"net/http"
	"time"

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
	flag.Parse()

	if cfg.maxViewers < 1 || cfg.maxPublishers < 1 || cfg.wsRateLimit < 1 || cfg.maxWSPerIP < 1 {
		log.Fatal("max-viewers, max-publishers, ws-rate-limit e max-ws-per-ip precisam ser maiores que zero")
	}
	if cfg.udpMin > 65535 || cfg.udpMax > 65535 || (cfg.udpMin == 0) != (cfg.udpMax == 0) || (cfg.udpMin > 0 && cfg.udpMin > cfg.udpMax) {
		log.Fatal("udp-min e udp-max precisam formar uma faixa válida entre 1 e 65535")
	}

	api, err := newWebRTCAPI(cfg.publicIP, cfg.udpMin, cfg.udpMax)
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
	log.Printf("ICE usando UDP %d-%d", cfg.udpMin, cfg.udpMax)
	log.Printf("limite WebSocket: %d tentativas/minuto e %d conexões/IP", cfg.wsRateLimit, cfg.maxWSPerIP)
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
