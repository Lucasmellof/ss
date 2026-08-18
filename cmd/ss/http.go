package main

import (
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v4"
)

type server struct {
	cfg     config
	api     *webrtc.API
	rooms   *roomManager
	limiter *ipRateLimiter
}

func (s *server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	ip := peerIP(r)
	if s.limiter != nil && !s.limiter.allow(ip, time.Now()) {
		w.Header().Set("Retry-After", "60")
		http.Error(w, "limite de conexões atingido", http.StatusTooManyRequests)
		return
	}
	if s.limiter != nil {
		defer s.limiter.release(ip)
	}
	upgrader := websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			return sameOrigin(r)
		},
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("websocket upgrade remote=%s: %v", r.RemoteAddr, err)
		return
	}
	socket := &signalSocket{conn: conn, done: make(chan struct{})}
	defer socket.close()
	conn.SetReadLimit(maxSignalMessageSize)
	_ = conn.SetReadDeadline(time.Now().Add(30 * time.Second))

	var join signalMessage
	if err := conn.ReadJSON(&join); err != nil {
		log.Printf("websocket join remote=%s: %v", r.RemoteAddr, err)
		return
	}
	if err := validateJoin(join); err != nil {
		_ = socket.write(signalMessage{Type: "error", Message: err.Error()})
		return
	}
	log.Printf("websocket joined room=%s role=%s remote=%s", join.Room, join.Role, r.RemoteAddr)
	rm := s.rooms.get(join.Room, s.cfg.maxViewers, s.cfg.maxPublishers)
	switch join.Role {
	case "publisher":
		s.handlePublisher(rm, socket, join.Room, join.ViewerID)
	case "viewer":
		s.handleViewer(rm, socket, join.Room, join.Name)
	}
}

func peerIP(r *http.Request) string {
	remote := requestHostname(r.RemoteAddr)
	if isLoopbackHost(remote) {
		for _, value := range []string{r.Header.Get("X-Forwarded-For"), r.Header.Get("X-Real-IP")} {
			for _, candidate := range strings.Split(value, ",") {
				candidate = strings.TrimSpace(candidate)
				if net.ParseIP(candidate) != nil {
					return candidate
				}
			}
		}
	}
	if net.ParseIP(remote) != nil {
		return remote
	}
	return "unknown"
}

func sameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" || origin == "null" {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	// Bundled desktop asset schemes are not internet origins and can signal
	// this server without weakening checks for browser origins.
	if u.Scheme == "views" || u.Scheme == "screen-share" {
		return true
	}
	// The Electron development renderer runs on Vite (127.0.0.1:5173),
	// while the local relay often listens on localhost:8080. Treat loopback
	// origins as the same local application, without relaxing VPS origins.
	if isLoopbackHost(u.Hostname()) && isLoopbackHost(requestHostname(r.Host)) {
		return true
	}
	return strings.EqualFold(u.Host, r.Host)
}

func requestHostname(host string) string {
	name, _, err := net.SplitHostPort(host)
	if err == nil {
		return name
	}
	return strings.Trim(host, "[]")
}

func isLoopbackHost(host string) bool {
	host = strings.Trim(strings.ToLower(host), "[]")
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; connect-src 'self' ws: wss:; media-src 'self' blob:; style-src 'self'; script-src 'self'; frame-ancestors 'none'")
		next.ServeHTTP(w, r)
	})
}

func healthHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_, _ = w.Write([]byte(`{"status":"ok"}`))
}
