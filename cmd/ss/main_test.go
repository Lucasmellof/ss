package main

import (
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/rtcp"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

func testServer(t *testing.T) *server {
	t.Helper()
	api, err := newWebRTCAPI("", 0, 0)
	if err != nil {
		t.Fatalf("newWebRTCAPI: %v", err)
	}
	return &server{
		cfg:   config{maxViewers: 2, maxPublishers: 4},
		api:   api,
		rooms: &roomManager{rooms: make(map[string]*room)},
	}
}

func TestValidateJoin(t *testing.T) {
	if err := validateJoin(signalMessage{Type: "join", Role: "viewer", Room: "sala-123"}); err != nil {
		t.Fatalf("valid join rejected: %v", err)
	}
	for _, message := range []signalMessage{
		{Type: "offer", Role: "viewer", Room: "sala-123"},
		{Type: "join", Role: "admin", Room: "sala-123"},
		{Type: "join", Role: "viewer", Room: "curta"},
		{Type: "join", Role: "viewer", Room: "sala com espaços"},
		{Type: "join", Role: "viewer", Room: ""},
	} {
		if err := validateJoin(message); err == nil {
			t.Fatalf("invalid join accepted: %+v", message)
		}
	}
}

func TestRoomViewerLimit(t *testing.T) {
	s := testServer(t)
	r := s.rooms.get("room-1234", 1, 4)
	v1 := &viewer{id: "one", room: r}
	if _, err := r.addViewer(v1); err != nil {
		t.Fatalf("first viewer rejected: %v", err)
	}
	v2 := &viewer{id: "two", room: r}
	if _, err := r.addViewer(v2); err == nil {
		t.Fatal("viewer limit was not enforced")
	}
}

func TestRoomAllowsMultiplePublishers(t *testing.T) {
	s := testServer(t)
	r := s.rooms.get("room-1234", 2, 2)
	first := &publisher{id: "pub-one", room: r}
	second := &publisher{id: "pub-two", room: r}
	third := &publisher{id: "pub-three", room: r}
	if err := r.addPublisher(first); err != nil {
		t.Fatalf("first publisher rejected: %v", err)
	}
	if err := r.addPublisher(second); err != nil {
		t.Fatalf("second publisher rejected: %v", err)
	}
	if err := r.addPublisher(third); err == nil {
		t.Fatal("publisher limit was not enforced")
	}
}

func TestPublisherStopAcknowledgesAfterRemoval(t *testing.T) {
	s := testServer(t)
	handler := http.NewServeMux()
	handler.HandleFunc("/ws", s.handleWebSocket)
	httpServer := httptest.NewServer(handler)
	t.Cleanup(httpServer.Close)
	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws"

	publisherWS := dialSignal(t, wsURL)
	joined := signalMessage{Type: "join", Role: "publisher", Room: "restart1", ViewerID: "viewer-one"}
	sendAndExpect(t, publisherWS, joined, "joined")
	if err := publisherWS.WriteJSON(signalMessage{Type: "stop"}); err != nil {
		t.Fatalf("stop publisher: %v", err)
	}
	stopped := readUntilType(t, publisherWS, "stopped")
	if stopped.PublisherID == "" {
		t.Fatal("stop acknowledgement did not include publisher id")
	}

	r := s.rooms.get("restart1", 2, 4)
	r.mu.RLock()
	remaining := len(r.publishers)
	r.mu.RUnlock()
	if remaining != 0 {
		t.Fatalf("publisher remained in room after stop acknowledgement: %d", remaining)
	}
}

func TestWebSocketPing(t *testing.T) {
	s := testServer(t)
	handler := http.NewServeMux()
	handler.HandleFunc("/ws", s.handleWebSocket)
	httpServer := httptest.NewServer(handler)
	t.Cleanup(httpServer.Close)
	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws"

	viewerWS := dialSignal(t, wsURL)
	sendAndExpect(t, viewerWS, signalMessage{Type: "join", Role: "viewer", Room: "pingroom"}, "joined")
	if err := viewerWS.WriteJSON(signalMessage{Type: "ping", PingID: "ping-1"}); err != nil {
		t.Fatalf("send ping: %v", err)
	}
	pong := readUntilType(t, viewerWS, "pong")
	if pong.PingID != "ping-1" {
		t.Fatalf("unexpected ping id: %q", pong.PingID)
	}
}

func TestHealth(t *testing.T) {
	recorder := httptest.NewRecorder()
	healthHandler(recorder, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if recorder.Code != http.StatusOK || recorder.Body.String() != `{"status":"ok"}` {
		t.Fatalf("unexpected health response: code=%d body=%q", recorder.Code, recorder.Body.String())
	}
}

func TestSameOrigin(t *testing.T) {
	for _, origin := range []string{"", "null", "https://share.example.com", "views://mainview", "screen-share://app"} {
		req := httptest.NewRequest(http.MethodGet, "https://share.example.com/ws", nil)
		req.Host = "share.example.com"
		req.Header.Set("Origin", origin)
		if !sameOrigin(req) {
			t.Fatalf("origin %q should be accepted", origin)
		}
	}
	req := httptest.NewRequest(http.MethodGet, "https://share.example.com/ws", nil)
	req.Host = "share.example.com"
	req.Header.Set("Origin", "https://outro.example.com")
	if sameOrigin(req) {
		t.Fatal("unexpected cross-origin websocket accepted")
	}
	loopback := httptest.NewRequest(http.MethodGet, "http://localhost:8080/ws", nil)
	loopback.Host = "localhost:8080"
	loopback.Header.Set("Origin", "http://127.0.0.1:5173")
	if !sameOrigin(loopback) {
		t.Fatal("loopback development origin should be accepted")
	}
}

func TestPeerIPTrustsForwardedHeadersOnlyBehindLoopback(t *testing.T) {
	proxied := httptest.NewRequest(http.MethodGet, "http://localhost:8080/ws", nil)
	proxied.RemoteAddr = "127.0.0.1:1234"
	proxied.Header.Set("X-Forwarded-For", "203.0.113.10, 127.0.0.1")
	if got := peerIP(proxied, nil); got != "203.0.113.10" {
		t.Fatalf("unexpected proxied IP: %q", got)
	}

	direct := httptest.NewRequest(http.MethodGet, "http://localhost:8080/ws", nil)
	direct.RemoteAddr = "203.0.113.20:1234"
	direct.Header.Set("X-Forwarded-For", "203.0.113.10")
	if got := peerIP(direct, nil); got != "203.0.113.20" {
		t.Fatalf("unexpected direct IP: %q", got)
	}
}

func TestParseTrustedProxies(t *testing.T) {
	networks, err := parseTrustedProxies(" 10.0.0.0/8, 192.168.1.5 fd00::/8\t2001:db8::1 ")
	if err != nil {
		t.Fatalf("parseTrustedProxies: %v", err)
	}
	want := []string{"10.0.0.0/8", "192.168.1.5/32", "fd00::/8", "2001:db8::1/128"}
	if len(networks) != len(want) {
		t.Fatalf("got %d networks, want %d", len(networks), len(want))
	}
	for i, network := range networks {
		if network.String() != want[i] {
			t.Fatalf("network %d = %s, want %s", i, network, want[i])
		}
	}

	empty, err := parseTrustedProxies("")
	if err != nil || len(empty) != 0 {
		t.Fatalf("empty value: networks=%v err=%v", empty, err)
	}

	for _, invalid := range []string{"not-an-ip", "10.0.0.0/33", "10.0.0.0/8,bogus"} {
		if _, err := parseTrustedProxies(invalid); err == nil {
			t.Fatalf("expected error for %q", invalid)
		}
	}
}

func TestPeerIPTrustsForwardedHeadersFromTrustedCIDR(t *testing.T) {
	trusted, err := parseTrustedProxies("10.42.0.0/16")
	if err != nil {
		t.Fatalf("parseTrustedProxies: %v", err)
	}

	ingress := httptest.NewRequest(http.MethodGet, "http://share.example.com/ws", nil)
	ingress.RemoteAddr = "10.42.3.7:5555"
	ingress.Header.Set("X-Forwarded-For", "198.51.100.1, 203.0.113.10, 10.42.0.9")
	if got := peerIP(ingress, trusted); got != "203.0.113.10" {
		t.Fatalf("unexpected client IP behind trusted proxy: %q", got)
	}

	realIP := httptest.NewRequest(http.MethodGet, "http://share.example.com/ws", nil)
	realIP.RemoteAddr = "10.42.3.7:5555"
	realIP.Header.Set("X-Real-IP", "203.0.113.11")
	if got := peerIP(realIP, trusted); got != "203.0.113.11" {
		t.Fatalf("unexpected X-Real-IP result: %q", got)
	}

	onlyProxies := httptest.NewRequest(http.MethodGet, "http://share.example.com/ws", nil)
	onlyProxies.RemoteAddr = "10.42.3.7:5555"
	onlyProxies.Header.Set("X-Forwarded-For", "10.42.0.8, 10.42.0.9")
	if got := peerIP(onlyProxies, trusted); got != "10.42.0.8" {
		t.Fatalf("unexpected result for proxy-only chain: %q", got)
	}

	untrusted := httptest.NewRequest(http.MethodGet, "http://share.example.com/ws", nil)
	untrusted.RemoteAddr = "10.43.0.1:5555"
	untrusted.Header.Set("X-Forwarded-For", "203.0.113.10")
	if got := peerIP(untrusted, trusted); got != "10.43.0.1" {
		t.Fatalf("untrusted peer should not be able to set forwarded headers: %q", got)
	}

	ipv6 := httptest.NewRequest(http.MethodGet, "http://share.example.com/ws", nil)
	ipv6.RemoteAddr = "[fd00::1]:5555"
	ipv6.Header.Set("X-Forwarded-For", "203.0.113.12")
	v6trusted := []*net.IPNet{{IP: net.ParseIP("fd00::"), Mask: net.CIDRMask(8, 128)}}
	if got := peerIP(ipv6, v6trusted); got != "203.0.113.12" {
		t.Fatalf("unexpected IPv6 proxy result: %q", got)
	}
}

func TestValidateUDPPort(t *testing.T) {
	for _, port := range []uint{0, 1, 40000, 65535} {
		if err := validateUDPPort(port); err != nil {
			t.Fatalf("port %d should be valid: %v", port, err)
		}
	}
	if err := validateUDPPort(65536); err == nil {
		t.Fatal("port 65536 should be rejected")
	}
	if _, _, err := newMuxedWebRTCAPI("", 0); err == nil {
		t.Fatal("single-port mode should reject port 0")
	}
}

func TestMuxedWebRTCAPI(t *testing.T) {
	probe, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatalf("pick free UDP port: %v", err)
	}
	port := uint(probe.LocalAddr().(*net.UDPAddr).Port)
	_ = probe.Close()

	api, closer, err := newMuxedWebRTCAPI("203.0.113.10", port)
	if err != nil {
		t.Fatalf("newMuxedWebRTCAPI: %v", err)
	}
	defer closer.Close()
	pc, err := api.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("NewPeerConnection: %v", err)
	}
	_ = pc.Close()

	if _, _, err := newMuxedWebRTCAPI("", port); err == nil {
		t.Fatal("binding the same UDP port twice should fail")
	}
}

func TestIPRateLimiter(t *testing.T) {
	limiter := newIPRateLimiter(2, 1)
	now := time.Unix(100, 0)
	if !limiter.allow("203.0.113.10", now) {
		t.Fatal("first connection was rejected")
	}
	if limiter.allow("203.0.113.10", now.Add(time.Second)) {
		t.Fatal("active connection limit was not enforced")
	}
	limiter.release("203.0.113.10")
	if limiter.allow("203.0.113.10", now.Add(2*time.Second)) {
		t.Fatal("attempt rate limit was not enforced")
	}
	if !limiter.allow("203.0.113.10", now.Add(61*time.Second)) {
		t.Fatal("expired rate limit did not allow a connection")
	}
}

func TestRelayStartsAfterPublisherTrack(t *testing.T) {
	s := testServer(t)
	handler := http.NewServeMux()
	handler.HandleFunc("/ws", s.handleWebSocket)
	httpServer := httptest.NewServer(handler)
	t.Cleanup(httpServer.Close)
	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws"

	publisherWS := dialSignal(t, wsURL)
	viewerWS := dialSignal(t, wsURL)
	publisherPC, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("create publisher PC: %v", err)
	}
	t.Cleanup(func() { _ = publisherPC.Close() })
	viewerPC, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("create viewer PC: %v", err)
	}
	t.Cleanup(func() { _ = viewerPC.Close() })

	receivedTrack := make(chan struct{}, 1)
	viewerPC.OnTrack(func(_ *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		select {
		case receivedTrack <- struct{}{}:
		default:
		}
	})

	videoTrack, err := webrtc.NewTrackLocalStaticRTP(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8, ClockRate: 90000},
		"video",
		"screen",
	)
	if err != nil {
		t.Fatalf("create video track: %v", err)
	}
	publisherSender, err := publisherPC.AddTrack(videoTrack)
	if err != nil {
		t.Fatalf("add video track: %v", err)
	}
	receivedPLI := make(chan struct{}, 1)
	go func() {
		for {
			packets, _, readErr := publisherSender.ReadRTCP()
			if readErr != nil {
				return
			}
			for _, packet := range packets {
				if _, ok := packet.(*rtcp.PictureLossIndication); ok {
					select {
					case receivedPLI <- struct{}{}:
					default:
					}
				}
			}
		}
	}()

	sendAndExpect(t, publisherWS, signalMessage{Type: "join", Role: "publisher", Room: "relayroom"}, "joined")
	publisherOffer := localOffer(t, publisherPC)
	if err := publisherWS.WriteJSON(signalMessage{Type: "offer", SDP: publisherOffer.SDP}); err != nil {
		t.Fatalf("send publisher offer: %v", err)
	}
	publisherAnswer := readUntilType(t, publisherWS, "answer")
	if err := publisherPC.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: publisherAnswer.SDP}); err != nil {
		t.Fatalf("set publisher answer: %v", err)
	}

	sendAndExpect(t, viewerWS, signalMessage{Type: "join", Role: "viewer", Room: "relayroom"}, "joined")
	stopWriting := make(chan struct{})
	go func() {
		sequence := uint16(0)
		ticker := time.NewTicker(15 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stopWriting:
				return
			case <-ticker.C:
				sequence++
				_ = videoTrack.WriteRTP(&rtp.Packet{
					Header:  rtp.Header{Version: 2, PayloadType: 96, SequenceNumber: sequence, Timestamp: uint32(sequence) * 3000, SSRC: 1},
					Payload: []byte{0x10},
				})
			}
		}
	}()
	t.Cleanup(func() { close(stopWriting) })

	viewerOffer := readUntilType(t, viewerWS, "offer")
	if err := viewerPC.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: viewerOffer.SDP}); err != nil {
		t.Fatalf("set viewer offer: %v", err)
	}
	viewerAnswer := localAnswer(t, viewerPC)
	if err := viewerWS.WriteJSON(signalMessage{Type: "answer", SDP: viewerAnswer.SDP}); err != nil {
		t.Fatalf("send viewer answer: %v", err)
	}

	select {
	case <-receivedTrack:
	case <-time.After(10 * time.Second):
		t.Fatal("viewer never received the relayed track")
	}
	select {
	case <-receivedPLI:
	case <-time.After(5 * time.Second):
		t.Fatal("publisher never received a keyframe request from the viewer")
	}
}

func TestRelayRestartsPublisherTrack(t *testing.T) {
	s := testServer(t)
	handler := http.NewServeMux()
	handler.HandleFunc("/ws", s.handleWebSocket)
	httpServer := httptest.NewServer(handler)
	t.Cleanup(httpServer.Close)
	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws"

	viewerWS := dialSignal(t, wsURL)
	viewerPC, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("create viewer PC: %v", err)
	}
	t.Cleanup(func() { _ = viewerPC.Close() })
	receivedVideo := make(chan struct{}, 2)
	viewerPC.OnTrack(func(track *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		if track.Kind() != webrtc.RTPCodecTypeVideo {
			return
		}
		select {
		case receivedVideo <- struct{}{}:
		default:
		}
	})

	publisherWS1 := dialSignal(t, wsURL)
	publisherPC1, video1 := setupTestPublisher(t, publisherWS1, "restartroom")
	stopRTP1 := startTestRTP(video1)
	defer stopRTP1()

	sendAndExpect(t, viewerWS, signalMessage{Type: "join", Role: "viewer", Room: "restartroom"}, "joined")
	completeViewerNegotiation(t, viewerWS, viewerPC)
	waitForVideoTrack(t, receivedVideo, "first publication")

	if err := publisherWS1.WriteJSON(signalMessage{Type: "stop"}); err != nil {
		t.Fatalf("stop first publisher: %v", err)
	}
	_ = readUntilType(t, publisherWS1, "stopped")
	completeViewerNegotiation(t, viewerWS, viewerPC)
	_ = publisherPC1.Close()

	publisherWS2 := dialSignal(t, wsURL)
	_, video2 := setupTestPublisher(t, publisherWS2, "restartroom")
	stopRTP2 := startTestRTP(video2)
	defer stopRTP2()
	completeViewerNegotiation(t, viewerWS, viewerPC)
	waitForVideoTrack(t, receivedVideo, "second publication")
}

func setupTestPublisher(t *testing.T, publisherWS *websocket.Conn, room string) (*webrtc.PeerConnection, *webrtc.TrackLocalStaticRTP) {
	t.Helper()
	publisherPC, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("create publisher PC: %v", err)
	}
	t.Cleanup(func() { _ = publisherPC.Close() })
	video, err := webrtc.NewTrackLocalStaticRTP(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8, ClockRate: 90000},
		"video-restart",
		"screen-restart",
	)
	if err != nil {
		t.Fatalf("create restart video track: %v", err)
	}
	sender, err := publisherPC.AddTrack(video)
	if err != nil {
		t.Fatalf("add restart video track: %v", err)
	}
	go func() {
		for {
			if _, _, readErr := sender.ReadRTCP(); readErr != nil {
				return
			}
		}
	}()
	sendAndExpect(t, publisherWS, signalMessage{Type: "join", Role: "publisher", Room: room}, "joined")
	offer := localOffer(t, publisherPC)
	if err := publisherWS.WriteJSON(signalMessage{Type: "offer", SDP: offer.SDP}); err != nil {
		t.Fatalf("send restart publisher offer: %v", err)
	}
	answer := readUntilType(t, publisherWS, "answer")
	if err := publisherPC.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: answer.SDP}); err != nil {
		t.Fatalf("set restart publisher answer: %v", err)
	}
	return publisherPC, video
}

func completeViewerNegotiation(t *testing.T, viewerWS *websocket.Conn, viewerPC *webrtc.PeerConnection) {
	t.Helper()
	offer := readUntilType(t, viewerWS, "offer")
	if err := viewerPC.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: offer.SDP}); err != nil {
		t.Fatalf("set viewer restart offer: %v", err)
	}
	answer := localAnswer(t, viewerPC)
	if err := viewerWS.WriteJSON(signalMessage{Type: "answer", SDP: answer.SDP}); err != nil {
		t.Fatalf("send viewer restart answer: %v", err)
	}
}

func startTestRTP(track *webrtc.TrackLocalStaticRTP) func() {
	stop := make(chan struct{})
	var once sync.Once
	go func() {
		sequence := uint16(0)
		ticker := time.NewTicker(15 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				sequence++
				_ = track.WriteRTP(&rtp.Packet{
					Header:  rtp.Header{Version: 2, PayloadType: 96, SequenceNumber: sequence, Timestamp: uint32(sequence) * 3000, SSRC: 1},
					Payload: []byte{0x10},
				})
			}
		}
	}()
	return func() { once.Do(func() { close(stop) }) }
}

func waitForVideoTrack(t *testing.T, received <-chan struct{}, publication string) {
	t.Helper()
	select {
	case <-received:
	case <-time.After(10 * time.Second):
		t.Fatalf("viewer never received the %s video track", publication)
	}
}

func dialSignal(t *testing.T, wsURL string) *websocket.Conn {
	t.Helper()
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

func sendAndExpect(t *testing.T, conn *websocket.Conn, message signalMessage, expectedType string) {
	t.Helper()
	if err := conn.WriteJSON(message); err != nil {
		t.Fatalf("send signal: %v", err)
	}
	_ = readUntilType(t, conn, expectedType)
}

func readUntilType(t *testing.T, conn *websocket.Conn, expectedType string) signalMessage {
	t.Helper()
	if err := conn.SetReadDeadline(time.Now().Add(15 * time.Second)); err != nil {
		t.Fatalf("set websocket deadline: %v", err)
	}
	for {
		var message signalMessage
		if err := conn.ReadJSON(&message); err != nil {
			t.Fatalf("read %s signal: %v", expectedType, err)
		}
		if message.Type == "error" {
			t.Fatalf("server signaling error: %s", message.Message)
		}
		if message.Type == expectedType {
			return message
		}
	}
}

func localOffer(t *testing.T, pc *webrtc.PeerConnection) webrtc.SessionDescription {
	t.Helper()
	gatheringDone := webrtc.GatheringCompletePromise(pc)
	offer, err := pc.CreateOffer(nil)
	if err != nil {
		t.Fatalf("create offer: %v", err)
	}
	if err = pc.SetLocalDescription(offer); err != nil {
		t.Fatalf("set local offer: %v", err)
	}
	awaitGathering(t, gatheringDone)
	return *pc.LocalDescription()
}

func localAnswer(t *testing.T, pc *webrtc.PeerConnection) webrtc.SessionDescription {
	t.Helper()
	gatheringDone := webrtc.GatheringCompletePromise(pc)
	answer, err := pc.CreateAnswer(nil)
	if err != nil {
		t.Fatalf("create answer: %v", err)
	}
	if err = pc.SetLocalDescription(answer); err != nil {
		t.Fatalf("set local answer: %v", err)
	}
	awaitGathering(t, gatheringDone)
	return *pc.LocalDescription()
}

func awaitGathering(t *testing.T, done <-chan struct{}) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("ICE gathering timed out")
	}
}
