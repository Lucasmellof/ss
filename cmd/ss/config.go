package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/pion/webrtc/v4"
)

const (
	maxSignalMessageSize = 1 << 20
	// Non-trickle signaling waits for the complete SDP so the relay can work
	// without a second candidate exchange.
	iceGatherTimeout     = 5 * time.Second
	defaultMaxViewers    = 20
	defaultMaxPublishers = 4
	defaultWSRateLimit   = 30
	defaultMaxWSPerIP    = 16
	defaultUDPMin        = 40000
	defaultUDPMax        = 40100
	websocketPongWait    = 45 * time.Second
	websocketPingPeriod  = 15 * time.Second
)

type config struct {
	addr           string
	publicIP       string
	maxViewers     int
	maxPublishers  int
	wsRateLimit    int
	maxWSPerIP     int
	udpMin         uint
	udpMax         uint
	udpPort        uint
	trustedProxies []*net.IPNet
}

var idCounter atomic.Uint64

func newSettingEngine(publicIP string) webrtc.SettingEngine {
	settings := webrtc.SettingEngine{}
	settings.SetLite(true)
	if publicIP != "" {
		settings.SetNAT1To1IPs([]string{publicIP}, webrtc.ICECandidateTypeHost)
	}
	return settings
}

func newWebRTCAPI(publicIP string, udpMin, udpMax uint) (*webrtc.API, error) {
	settings := newSettingEngine(publicIP)
	if udpMin > 0 {
		if err := settings.SetEphemeralUDPPortRange(uint16(udpMin), uint16(udpMax)); err != nil {
			return nil, err
		}
	}
	return webrtc.NewAPI(webrtc.WithSettingEngine(settings)), nil
}

func newMuxedWebRTCAPI(publicIP string, udpPort uint) (*webrtc.API, io.Closer, error) {
	if err := validateUDPPort(udpPort); err != nil {
		return nil, nil, err
	}
	if udpPort == 0 {
		return nil, nil, errors.New("udp-port must be set for single-port mode")
	}
	conn, err := net.ListenUDP("udp", &net.UDPAddr{Port: int(udpPort)})
	if err != nil {
		return nil, nil, fmt.Errorf("listen on UDP port %d: %w", udpPort, err)
	}
	mux := webrtc.NewICEUDPMux(nil, conn)
	settings := newSettingEngine(publicIP)
	settings.SetICEUDPMux(mux)
	return webrtc.NewAPI(webrtc.WithSettingEngine(settings)), mux, nil
}

func validateUDPPort(port uint) error {
	if port > 65535 {
		return fmt.Errorf("udp-port must be between 1 and 65535, got %d", port)
	}
	return nil
}

func parseTrustedProxies(value string) ([]*net.IPNet, error) {
	var networks []*net.IPNet
	for _, entry := range strings.FieldsFunc(value, func(r rune) bool {
		return r == ',' || r == ' ' || r == '\t' || r == '\n'
	}) {
		if !strings.Contains(entry, "/") {
			ip := net.ParseIP(entry)
			if ip == nil {
				return nil, fmt.Errorf("invalid trusted proxy %q", entry)
			}
			bits := 128
			if ip4 := ip.To4(); ip4 != nil {
				ip, bits = ip4, 32
			}
			networks = append(networks, &net.IPNet{IP: ip, Mask: net.CIDRMask(bits, bits)})
			continue
		}
		_, network, err := net.ParseCIDR(entry)
		if err != nil {
			return nil, fmt.Errorf("invalid trusted proxy CIDR %q: %w", entry, err)
		}
		networks = append(networks, network)
	}
	return networks, nil
}

func nextID(prefix string) string {
	return prefix + "-" + strconv.FormatUint(idCounter.Add(1), 36)
}

func newResumeToken() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		panic(err)
	}
	return hex.EncodeToString(buf)
}

func envOr(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func envIntOr(name string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envUintOr(name string, fallback uint) uint {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseUint(value, 10, 64)
	if err != nil {
		return fallback
	}
	return uint(parsed)
}
