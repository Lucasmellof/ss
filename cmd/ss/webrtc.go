package main

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/pion/webrtc/v4"
)

func setRemoteOfferAndAnswer(pc *webrtc.PeerConnection, socket *signalSocket, sdp string) error {
	if strings.TrimSpace(sdp) == "" {
		return errors.New("offer WebRTC vazio")
	}
	if err := pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: sdp}); err != nil {
		return fmt.Errorf("offer WebRTC inválido: %w", err)
	}
	gatherComplete := webrtc.GatheringCompletePromise(pc)
	answer, err := pc.CreateAnswer(nil)
	if err != nil {
		return fmt.Errorf("criar answer WebRTC: %w", err)
	}
	if err := pc.SetLocalDescription(answer); err != nil {
		return fmt.Errorf("ativar answer WebRTC: %w", err)
	}
	if err := waitGathering(gatherComplete); err != nil {
		return fmt.Errorf("reunir candidatos ICE: %w", err)
	}
	local := pc.LocalDescription()
	if local == nil {
		return errors.New("answer WebRTC não foi criado")
	}
	return socket.write(signalMessage{Type: "answer", SDP: local.SDP})
}

func waitGathering(done <-chan struct{}) error {
	select {
	case <-done:
		return nil
	case <-time.After(iceGatherTimeout):
		return errors.New("tempo esgotado reunindo candidatos ICE")
	}
}
