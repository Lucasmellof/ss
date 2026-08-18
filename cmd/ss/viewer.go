package main

import (
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/pion/rtcp"
	"github.com/pion/webrtc/v4"
)

type viewer struct {
	id          string
	name        string
	room        *room
	socket      *signalSocket
	pc          *webrtc.PeerConnection
	mu          sync.Mutex
	senders     map[string]*webrtc.RTPSender
	tracks      map[string]*forwardedTrack
	pending     bool
	negotiating bool
	closed      bool
	closeOnce   sync.Once
	negMu       sync.Mutex
}

func (s *server) handleViewer(rm *room, socket *signalSocket, roomID, name string) {
	pc, err := s.api.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		_ = socket.write(signalMessage{Type: "error", Message: "não foi possível criar a conexão WebRTC"})
		return
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = "Participante"
	}
	if runes := []rune(name); len(runes) > 32 {
		name = string(runes[:32])
	}
	v := &viewer{
		id:      nextID("view"),
		name:    name,
		room:    rm,
		socket:  socket,
		pc:      pc,
		senders: make(map[string]*webrtc.RTPSender),
		tracks:  make(map[string]*forwardedTrack),
	}
	tracks, err := rm.addViewer(v)
	if err != nil {
		_ = pc.Close()
		_ = socket.write(signalMessage{Type: "error", Message: err.Error()})
		return
	}
	defer v.close("sala encerrada")
	socket.startHeartbeat()

	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		log.Printf("viewer=%s peer state=%s", v.id, state)
		if state == webrtc.PeerConnectionStateFailed || state == webrtc.PeerConnectionStateClosed {
			v.close("conexão encerrada")
		}
	})

	if err := socket.write(signalMessage{Type: "joined", Role: "viewer", Room: roomID, ViewerID: v.id}); err != nil {
		return
	}
	rm.broadcastStatus()
	rm.addTracksToViewer(v, tracks)

	for {
		var message signalMessage
		if err := readSignal(socket.conn, &message); err != nil {
			log.Printf("viewer=%s room=%s disconnected: %v", v.id, roomID, err)
			return
		}
		switch message.Type {
		case "ping":
			if err := socket.write(signalMessage{Type: "pong", PingID: message.PingID}); err != nil {
				return
			}
		case "answer":
			if err := v.handleAnswer(message.SDP); err != nil {
				_ = socket.write(signalMessage{Type: "error", Message: err.Error()})
				return
			}
		case "stop":
			return
		default:
			_ = socket.write(signalMessage{Type: "error", Message: "mensagem de sinalização desconhecida"})
		}
	}
}

func (v *viewer) addTracks(tracks []*forwardedTrack) {
	if len(tracks) == 0 {
		return
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.closed {
		return
	}
	for _, track := range tracks {
		if _, exists := v.senders[track.id]; exists {
			continue
		}
		transceiver, err := v.pc.AddTransceiverFromTrack(track.local, webrtc.RTPTransceiverInit{Direction: webrtc.RTPTransceiverDirectionSendonly})
		if err != nil {
			log.Printf("viewer=%s add track=%s: %v", v.id, track.id, err)
			continue
		}
		sender := transceiver.Sender()
		log.Printf("viewer=%s add track=%s kind=%s transceiver_mid=%s", v.id, track.id, track.kind, transceiver.Mid())
		v.senders[track.id] = sender
		v.tracks[track.id] = track
		go relayViewerRTCP(v.id, sender, track)
	}
	if len(v.senders) > 0 {
		v.pending = true
	}
	v.tryNegotiate()
}

func (v *viewer) removeTracks(tracks []*forwardedTrack, publisherID string) {
	if len(tracks) == 0 {
		return
	}
	removedIDs := make([]string, 0, len(tracks))
	v.mu.Lock()
	if v.closed {
		v.mu.Unlock()
		return
	}
	for _, track := range tracks {
		sender, exists := v.senders[track.id]
		if !exists {
			continue
		}
		if err := v.pc.RemoveTrack(sender); err != nil {
			log.Printf("viewer=%s remove track=%s: %v", v.id, track.id, err)
		}
		delete(v.senders, track.id)
		delete(v.tracks, track.id)
		removedIDs = append(removedIDs, track.id)
	}
	if len(removedIDs) > 0 {
		v.pending = true
	}
	v.mu.Unlock()
	if len(removedIDs) == 0 {
		return
	}
	log.Printf("viewer=%s remove tracks=%v publisher=%s", v.id, removedIDs, publisherID)
	_ = v.socket.write(signalMessage{Type: "tracks-removed", PublisherID: publisherID, TrackIDs: removedIDs})
	v.tryNegotiate()
}

func (v *viewer) tryNegotiate() {
	go func() {
		v.negMu.Lock()
		defer v.negMu.Unlock()

		v.mu.Lock()
		if v.closed || !v.pending || v.negotiating || v.pc.SignalingState() != webrtc.SignalingStateStable {
			v.mu.Unlock()
			return
		}
		v.pending = false
		v.negotiating = true
		trackCount := len(v.tracks)
		v.mu.Unlock()
		log.Printf("viewer=%s offer creating tracks=%d", v.id, trackCount)

		gatherComplete := webrtc.GatheringCompletePromise(v.pc)
		offer, err := v.pc.CreateOffer(nil)
		if err == nil {
			err = v.pc.SetLocalDescription(offer)
		}
		if err == nil {
			err = waitGathering(gatherComplete)
		}
		if err == nil && v.pc.LocalDescription() != nil {
			log.Printf("viewer=%s offer sending sdp_bytes=%d", v.id, len(v.pc.LocalDescription().SDP))
			err = v.socket.write(signalMessage{Type: "offer", SDP: v.pc.LocalDescription().SDP})
		}
		if err != nil {
			log.Printf("viewer=%s negotiate: %v", v.id, err)
		}
		v.mu.Lock()
		v.negotiating = false
		if err != nil {
			v.pending = true
		}
		closed := v.closed
		pending := v.pending
		v.mu.Unlock()
		if err != nil && !closed {
			_ = v.socket.write(signalMessage{Type: "error", Message: "não foi possível iniciar o vídeo"})
		}
		if pending && !closed {
			// An answer will normally trigger the next negotiation. This retry
			// handles the case where the peer became stable during this attempt.
			go v.tryNegotiate()
		}
	}()
}

func (v *viewer) handleAnswer(sdp string) error {
	if strings.TrimSpace(sdp) == "" {
		return errors.New("answer WebRTC vazio")
	}
	v.negMu.Lock()
	defer v.negMu.Unlock()
	if err := v.pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: sdp}); err != nil {
		return fmt.Errorf("answer WebRTC inválido: %w", err)
	}
	log.Printf("viewer=%s answer applied sdp_bytes=%d", v.id, len(sdp))
	v.mu.Lock()
	v.negotiating = false
	pending := v.pending
	closed := v.closed
	v.mu.Unlock()
	if !closed {
		v.requestKeyframes()
	}
	if pending && !closed {
		go v.tryNegotiate()
	}
	return nil
}

func (v *viewer) requestKeyframes() {
	v.mu.Lock()
	tracks := make([]*forwardedTrack, 0, len(v.tracks))
	for _, track := range v.tracks {
		if track.kind == webrtc.RTPCodecTypeVideo {
			tracks = append(tracks, track)
		}
	}
	v.mu.Unlock()
	go func() {
		// The first PLI can happen before ICE becomes connected. A few retries
		// make sure a restarted publisher receives a decodable frame quickly.
		for attempt := 0; attempt < 3; attempt++ {
			if attempt > 0 {
				time.Sleep(time.Second)
			}
			for _, track := range tracks {
				track.requestKeyframe()
			}
		}
	}()
}

func relayViewerRTCP(viewerID string, sender *webrtc.RTPSender, track *forwardedTrack) {
	for {
		packets, _, err := sender.ReadRTCP()
		if err != nil {
			return
		}
		for _, packet := range packets {
			switch packet.(type) {
			case *rtcp.PictureLossIndication, *rtcp.FullIntraRequest:
				log.Printf("viewer=%s receiver keyframe request track=%s packet=%T", viewerID, track.id, packet)
				track.requestKeyframe()
			}
		}
	}
}

func (v *viewer) close(reason string) {
	v.closeOnce.Do(func() {
		v.mu.Lock()
		v.closed = true
		v.mu.Unlock()
		if reason != "" {
			_ = v.socket.write(signalMessage{Type: "ended", Message: reason})
		}
		_ = v.pc.Close()
		v.socket.close()
		v.room.removeViewer(v)
	})
}
