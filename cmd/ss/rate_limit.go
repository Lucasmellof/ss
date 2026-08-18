package main

import (
	"strings"
	"sync"
	"time"
)

const ipRateLimitWindow = time.Minute

type ipRateLimiter struct {
	mu          sync.Mutex
	window      time.Duration
	maxAttempts int
	maxActive   int
	attempts    map[string][]time.Time
	active      map[string]int
	lastCleanup time.Time
}

func newIPRateLimiter(maxAttempts, maxActive int) *ipRateLimiter {
	return &ipRateLimiter{
		window:      ipRateLimitWindow,
		maxAttempts: maxAttempts,
		maxActive:   maxActive,
		attempts:    make(map[string][]time.Time),
		active:      make(map[string]int),
	}
}

func (l *ipRateLimiter) allow(ip string, now time.Time) bool {
	ip = limiterKey(ip)
	l.mu.Lock()
	defer l.mu.Unlock()

	l.cleanup(now)
	cutoff := now.Add(-l.window)
	recent := recentAttempts(l.attempts[ip], cutoff)
	l.attempts[ip] = append(recent, now)
	if len(recent) >= l.maxAttempts || l.active[ip] >= l.maxActive {
		return false
	}
	l.active[ip]++
	return true
}

func (l *ipRateLimiter) release(ip string) {
	ip = limiterKey(ip)
	l.mu.Lock()
	defer l.mu.Unlock()

	if l.active[ip] <= 1 {
		delete(l.active, ip)
		return
	}
	l.active[ip]--
}

func (l *ipRateLimiter) cleanup(now time.Time) {
	if !l.lastCleanup.IsZero() && now.Sub(l.lastCleanup) < l.window {
		return
	}
	cutoff := now.Add(-l.window)
	for ip, attempts := range l.attempts {
		recent := recentAttempts(attempts, cutoff)
		if len(recent) == 0 && l.active[ip] == 0 {
			delete(l.attempts, ip)
			continue
		}
		l.attempts[ip] = recent
	}
	l.lastCleanup = now
}

func recentAttempts(attempts []time.Time, cutoff time.Time) []time.Time {
	first := 0
	for first < len(attempts) && !attempts[first].After(cutoff) {
		first++
	}
	return attempts[first:]
}

func limiterKey(ip string) string {
	if trimmed := strings.TrimSpace(ip); trimmed != "" {
		return trimmed
	}
	return "unknown"
}
