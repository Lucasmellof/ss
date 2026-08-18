package main

import (
	"errors"
	"fmt"
	"regexp"

	"github.com/gorilla/websocket"
)

type signalMessage struct {
	Type         string        `json:"type"`
	Role         string        `json:"role,omitempty"`
	Room         string        `json:"room,omitempty"`
	SDP          string        `json:"sdp,omitempty"`
	Message      string        `json:"message,omitempty"`
	Viewers      int           `json:"viewers,omitempty"`
	PublisherID  string        `json:"publisherId,omitempty"`
	ViewerID     string        `json:"viewerId,omitempty"`
	TrackIDs     []string      `json:"trackIds,omitempty"`
	PingID       string        `json:"pingId,omitempty"`
	Name         string        `json:"name,omitempty"`
	Members      []memberInfo  `json:"members,omitempty"`
	Streaming    []string      `json:"streamingMembers,omitempty"`
	StreamOwners []streamOwner `json:"streamOwners,omitempty"`
}

type memberInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type streamOwner struct {
	PublisherID string `json:"publisherId"`
	ViewerID    string `json:"viewerId"`
	Name        string `json:"name"`
}

const (
	minRoomLength = 8
	maxRoomLength = 64
)

var validRoom = regexp.MustCompile(`^[a-zA-Z0-9_-]{8,64}$`)

func readSignal(conn *websocket.Conn, message *signalMessage) error {
	return conn.ReadJSON(message)
}

func validateJoin(message signalMessage) error {
	if message.Type != "join" {
		return errors.New("a primeira mensagem precisa ser join")
	}
	if message.Role != "publisher" && message.Role != "viewer" {
		return errors.New("papel inválido")
	}
	if !validRoom.MatchString(message.Room) {
		return fmt.Errorf("nome de sala inválido: use de %d a %d caracteres, somente letras, números, hífen ou sublinhado", minRoomLength, maxRoomLength)
	}
	return nil
}
