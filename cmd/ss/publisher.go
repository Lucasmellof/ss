package main

import (
	"errors"
	"io"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pion/rtcp"
	"github.com/pion/webrtc/v4"
)

type forwardedTrack struct {
	id              string
	local           *webrtc.TrackLocalStaticRTP
	kind            webrtc.RTPCodecType
	requestKeyframe func()
}

type publisher struct {
	id          string
	viewerID    string
	room        *room
	socket      *signalSocket
	pc          *webrtc.PeerConnection
	hasTrack    atomic.Bool
	stopRequest atomic.Bool
	warningOnce sync.Once
	closeOnce   sync.Once
	done        chan struct{}
}

func (s *server) handlePublisher(rm *room, socket *signalSocket, roomID, viewerID string) {
	pc, err := s.api.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		_ = socket.write(signalMessage{Type: "error", Message: "não foi possível criar a conexão WebRTC"})
		return
	}
	p := &publisher{id: nextID("pub"), viewerID: viewerID, room: rm, socket: socket, pc: pc, done: make(chan struct{})}
	if err := rm.addPublisher(p); err != nil {
		_ = pc.Close()
		_ = socket.write(signalMessage{Type: "error", Message: err.Error()})
		return
	}
	defer p.close("transmissão encerrada")
	socket.startHeartbeat()

	pc.OnTrack(func(track *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		log.Printf("publisher=%s source track id=%s kind=%s ssrc=%d codec=%s", p.id, track.ID(), track.Kind(), track.SSRC(), track.Codec().MimeType)
		go s.forwardTrack(p, track)
	})
	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		log.Printf("publisher=%s peer state=%s", p.id, state)
		if state == webrtc.PeerConnectionStateFailed || state == webrtc.PeerConnectionStateClosed {
			p.close("conexão do transmissor encerrada")
		}
	})

	if err := socket.write(signalMessage{Type: "joined", Role: "publisher", Room: roomID, PublisherID: p.id}); err != nil {
		return
	}
	rm.broadcastStatus()

	for {
		var message signalMessage
		if err := readSignal(socket.conn, &message); err != nil {
			log.Printf("publisher=%s room=%s disconnected: %v", p.id, roomID, err)
			return
		}
		switch message.Type {
		case "ping":
			if err := socket.write(signalMessage{Type: "pong", PingID: message.PingID}); err != nil {
				return
			}
		case "offer":
			log.Printf("publisher=%s offer received sdp_bytes=%d", p.id, len(message.SDP))
			if err := setRemoteOfferAndAnswer(pc, socket, message.SDP); err != nil {
				_ = socket.write(signalMessage{Type: "error", Message: err.Error()})
				return
			}
			p.warnIfNoMedia()
		case "stop":
			log.Printf("publisher=%s stop requested", p.id)
			p.stopRequest.Store(true)
			return
		default:
			_ = socket.write(signalMessage{Type: "error", Message: "mensagem de sinalização desconhecida"})
		}
	}
}

func (s *server) forwardTrack(p *publisher, remote *webrtc.TrackRemote) {
	p.hasTrack.Store(true)
	codec := remote.Codec()
	trackID := p.id + ":" + remote.ID() + ":" + remote.Kind().String()
	local, err := webrtc.NewTrackLocalStaticRTP(codec.RTPCodecCapability, trackID, p.id)
	if err != nil {
		log.Printf("track %s: %v", remote.ID(), err)
		return
	}
	forwarded := &forwardedTrack{
		id:    trackID,
		local: local,
		kind:  remote.Kind(),
		requestKeyframe: func() {
			if remote.Kind() != webrtc.RTPCodecTypeVideo {
				return
			}
			mediaSSRC := uint32(remote.SSRC())
			if err := p.pc.WriteRTCP([]rtcp.Packet{
				&rtcp.PictureLossIndication{MediaSSRC: mediaSSRC},
			}); err != nil {
				log.Printf("publisher=%s keyframe request: %v", p.id, err)
			} else {
				log.Printf("publisher=%s keyframe request sent track=%s ssrc=%d", p.id, trackID, mediaSSRC)
			}
		},
	}
	if err := p.room.addTrack(p, forwarded); err != nil {
		return
	}
	if remote.Kind() == webrtc.RTPCodecTypeVideo {
		go requestTrackKeyframes(p, forwarded)
	}
	defer p.room.removeTrack(p, forwarded)
	log.Printf("room=%s track=%s codec=%s forwarding_started", p.room.id, forwarded.id, codec.MimeType)

	packetCount := 0
	for {
		packet, _, err := remote.ReadRTP()
		if err != nil {
			if !errors.Is(err, io.EOF) {
				log.Printf("room=%s track=%s forwarding_stopped packets=%d error=%v", p.room.id, forwarded.id, packetCount, err)
			} else {
				log.Printf("room=%s track=%s forwarding_stopped packets=%d error=EOF", p.room.id, forwarded.id, packetCount)
			}
			return
		}
		packetCount++
		if packetCount == 1 {
			log.Printf("room=%s track=%s first_rtp sequence=%d timestamp=%d payload_bytes=%d", p.room.id, forwarded.id, packet.SequenceNumber, packet.Timestamp, len(packet.Payload))
		}
		if err := local.WriteRTP(packet); err != nil && !errors.Is(err, io.ErrClosedPipe) {
			// A track can briefly have no viewers; the next packet will be retried.
		}
	}
}

func requestTrackKeyframes(p *publisher, track *forwardedTrack) {
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			timer := time.NewTimer(time.Second)
			select {
			case <-p.done:
				timer.Stop()
				return
			case <-timer.C:
			}
		}
		select {
		case <-p.done:
			return
		default:
		}
		log.Printf("publisher=%s keyframe attempt=%d track=%s state=%s", p.id, attempt+1, track.id, p.pc.ConnectionState())
		track.requestKeyframe()
	}
}

func (p *publisher) warnIfNoMedia() {
	p.warningOnce.Do(func() {
		time.AfterFunc(12*time.Second, func() {
			if !p.hasTrack.Load() {
				_ = p.socket.write(signalMessage{
					Type:    "warning",
					Message: "A VPS ainda não recebeu mídia. Confira HTTPS, PUBLIC_IP e UDP 40000-40100.",
				})
			}
		})
	})
}

func (p *publisher) close(reason string) {
	p.closeOnce.Do(func() {
		if p.done != nil {
			close(p.done)
		}
		log.Printf("publisher=%s closing reason=%s", p.id, reason)
		p.room.removePublisher(p, reason)
		if p.stopRequest.Load() {
			_ = p.socket.write(signalMessage{Type: "stopped", PublisherID: p.id})
		}
		_ = p.pc.Close()
		p.socket.close()
	})
}
