package main

import (
	"errors"
	"sort"
	"strings"
	"sync"
)

type roomManager struct {
	mu    sync.Mutex
	rooms map[string]*room
}

type room struct {
	mu            sync.RWMutex
	statusMu      sync.Mutex
	id            string
	publishers    map[string]*publisher
	viewers       map[string]*viewer
	tracks        map[string]*forwardedTrack
	maxViewers    int
	maxPublishers int
	manager       *roomManager
}

func (m *roomManager) get(id string, maxViewers, maxPublishers int) *room {
	m.mu.Lock()
	defer m.mu.Unlock()
	if existing, ok := m.rooms[id]; ok {
		return existing
	}
	created := &room{id: id, publishers: make(map[string]*publisher), viewers: make(map[string]*viewer), tracks: make(map[string]*forwardedTrack), maxViewers: maxViewers, maxPublishers: maxPublishers, manager: m}
	m.rooms[id] = created
	return created
}

func (m *roomManager) removeIfEmpty(r *room) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r.mu.RLock()
	empty := len(r.publishers) == 0 && len(r.viewers) == 0
	r.mu.RUnlock()
	if empty && m.rooms[r.id] == r {
		delete(m.rooms, r.id)
	}
}

func (r *room) addPublisher(p *publisher) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.publishers) >= r.maxPublishers {
		return errors.New("a sala atingiu o limite de transmissões")
	}
	r.publishers[p.id] = p
	return nil
}

func (r *room) addViewer(v *viewer) ([]*forwardedTrack, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.viewers) >= r.maxViewers {
		return nil, errors.New("a sala atingiu o limite de espectadores")
	}
	r.viewers[v.id] = v
	tracks := make([]*forwardedTrack, 0, len(r.tracks))
	for _, track := range r.tracks {
		tracks = append(tracks, track)
	}
	return tracks, nil
}

func (r *room) addTrack(p *publisher, track *forwardedTrack) error {
	r.mu.Lock()
	if r.publishers[p.id] != p {
		r.mu.Unlock()
		return errors.New("transmissor não está mais conectado")
	}
	if _, exists := r.tracks[track.id]; exists {
		r.mu.Unlock()
		return errors.New("track duplicada")
	}
	r.tracks[track.id] = track
	for _, viewer := range r.viewers {
		viewer.addTracks([]*forwardedTrack{track})
	}
	r.mu.Unlock()
	return nil
}

func (r *room) addTracksToViewer(v *viewer, tracks []*forwardedTrack) {
	r.mu.RLock()
	active := make([]*forwardedTrack, 0, len(tracks))
	for _, track := range tracks {
		if r.tracks[track.id] == track {
			active = append(active, track)
		}
	}
	v.addTracks(active)
	r.mu.RUnlock()
}

func (r *room) removeViewer(v *viewer) {
	r.mu.Lock()
	if r.viewers[v.id] == v {
		delete(r.viewers, v.id)
	}
	r.mu.Unlock()
	r.broadcastStatus()
	r.manager.removeIfEmpty(r)
}

func (r *room) removeTrack(p *publisher, track *forwardedTrack) {
	r.mu.Lock()
	if r.publishers[p.id] != p || r.tracks[track.id] != track {
		r.mu.Unlock()
		return
	}
	delete(r.tracks, track.id)
	viewers := make([]*viewer, 0, len(r.viewers))
	for _, viewer := range r.viewers {
		viewers = append(viewers, viewer)
	}
	r.mu.Unlock()
	for _, viewer := range viewers {
		viewer.removeTracks([]*forwardedTrack{track}, p.id)
	}
}

func (r *room) removePublisher(p *publisher, reason string) {
	r.mu.Lock()
	if r.publishers[p.id] != p {
		r.mu.Unlock()
		return
	}
	delete(r.publishers, p.id)
	removedTracks := make([]*forwardedTrack, 0)
	for id := range r.tracks {
		if strings.HasPrefix(id, p.id+":") {
			removedTracks = append(removedTracks, r.tracks[id])
			delete(r.tracks, id)
		}
	}
	viewers := make([]*viewer, 0, len(r.viewers))
	for _, viewer := range r.viewers {
		viewers = append(viewers, viewer)
	}
	r.mu.Unlock()
	for _, viewer := range viewers {
		viewer.removeTracks(removedTracks, p.id)
	}
	r.broadcastStatus()
	r.manager.removeIfEmpty(r)
}

func (r *room) broadcastStatus() {
	r.statusMu.Lock()
	defer r.statusMu.Unlock()
	r.mu.RLock()
	publishers := make([]*publisher, 0, len(r.publishers))
	for _, publisher := range r.publishers {
		publishers = append(publishers, publisher)
	}
	viewerList := make([]*viewer, 0, len(r.viewers))
	for _, viewer := range r.viewers {
		viewerList = append(viewerList, viewer)
	}
	streamingSet := make(map[string]struct{})
	for _, publisher := range publishers {
		if publisher.viewerID != "" {
			streamingSet[publisher.viewerID] = struct{}{}
		}
	}
	r.mu.RUnlock()

	viewers := len(viewerList)
	members := make([]memberInfo, 0, viewers)
	for _, viewer := range viewerList {
		members = append(members, memberInfo{ID: viewer.id, Name: viewer.name})
	}
	sort.Slice(members, func(i, j int) bool {
		if members[i].Name == members[j].Name {
			return members[i].ID < members[j].ID
		}
		return members[i].Name < members[j].Name
	})
	streaming := make([]string, 0, len(streamingSet))
	for viewerID := range streamingSet {
		streaming = append(streaming, viewerID)
	}
	sort.Strings(streaming)
	streamOwners := make([]streamOwner, 0, len(streamingSet))
	for _, publisher := range publishers {
		if publisher.viewerID == "" {
			continue
		}
		for _, viewer := range viewerList {
			if viewer.id == publisher.viewerID {
				streamOwners = append(streamOwners, streamOwner{PublisherID: publisher.id, ViewerID: viewer.id, Name: viewer.name})
				break
			}
		}
	}
	sort.Slice(streamOwners, func(i, j int) bool {
		return streamOwners[i].PublisherID < streamOwners[j].PublisherID
	})
	for _, publisher := range publishers {
		_ = publisher.socket.write(signalMessage{Type: "status", Viewers: viewers})
	}
	for _, viewer := range viewerList {
		_ = viewer.socket.write(signalMessage{Type: "status", Viewers: viewers, Members: members, Streaming: streaming, StreamOwners: streamOwners})
	}
}
