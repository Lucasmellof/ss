package main

import (
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
	addr          string
	publicIP      string
	maxViewers    int
	maxPublishers int
	wsRateLimit   int
	maxWSPerIP    int
	udpMin        uint
	udpMax        uint
}

var idCounter atomic.Uint64

func newWebRTCAPI(publicIP string, udpMin, udpMax uint) (*webrtc.API, error) {
	settings := webrtc.SettingEngine{}
	if publicIP != "" {
		settings.SetNAT1To1IPs([]string{publicIP}, webrtc.ICECandidateTypeHost)
	}
	if udpMin > 0 {
		if err := settings.SetEphemeralUDPPortRange(uint16(udpMin), uint16(udpMax)); err != nil {
			return nil, err
		}
	}
	return webrtc.NewAPI(webrtc.WithSettingEngine(settings)), nil
}

func nextID(prefix string) string {
	return prefix + "-" + strconv.FormatUint(idCounter.Add(1), 36)
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
