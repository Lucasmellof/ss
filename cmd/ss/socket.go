package main

import (
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type signalSocket struct {
	conn      *websocket.Conn
	writeMu   sync.Mutex
	closeOnce sync.Once
	done      chan struct{}
}

func (s *signalSocket) write(message signalMessage) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	_ = s.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return s.conn.WriteJSON(message)
}

func (s *signalSocket) close() {
	s.closeOnce.Do(func() {
		close(s.done)
		_ = s.conn.Close()
	})
}

func (s *signalSocket) startHeartbeat() {
	_ = s.conn.SetReadDeadline(time.Now().Add(websocketPongWait))
	s.conn.SetPongHandler(func(string) error {
		return s.conn.SetReadDeadline(time.Now().Add(websocketPongWait))
	})
	go func() {
		ticker := time.NewTicker(websocketPingPeriod)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if err := s.ping(); err != nil {
					s.close()
					return
				}
			case <-s.done:
				return
			}
		}
	}()
}

func (s *signalSocket) ping() error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	return s.conn.WriteControl(websocket.PingMessage, []byte("ping"), time.Now().Add(10*time.Second))
}
