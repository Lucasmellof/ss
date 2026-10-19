package main

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"log"
	"math"
	"sort"
	"sync"
	"time"
)

const (
	mixFrameDuration = 10 * time.Millisecond
	mixFrameFrames   = mixSampleRate / 100
	mixFrameSamples  = mixFrameFrames * mixChannels
	mixPrimeSamples  = 2 * mixFrameSamples
	mixMaxSamples    = 20 * mixFrameSamples
	mixMaxCatchUp    = 20
	sourceRetryDelay = 5 * time.Second
)

type source interface {
	key() string
	run(ctx context.Context, sink func([]float32)) error
}

type mixerInput struct {
	samples []float32
	primed  bool
}

type mixer struct {
	mu     sync.Mutex
	inputs map[string]*mixerInput
}

func newMixer() *mixer {
	return &mixer{inputs: make(map[string]*mixerInput)}
}

func (m *mixer) add(key string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.inputs[key]; !exists {
		m.inputs[key] = &mixerInput{}
	}
}

func (m *mixer) remove(key string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.inputs, key)
}

func (m *mixer) push(key string, samples []float32) {
	if len(samples) == 0 {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	input, ok := m.inputs[key]
	if !ok {
		return
	}
	input.samples = append(input.samples, samples...)
	if excess := len(input.samples) - mixMaxSamples; excess > 0 {
		excess += excess % mixChannels
		input.samples = append(input.samples[:0], input.samples[excess:]...)
	}
	if !input.primed && len(input.samples) >= mixPrimeSamples {
		input.primed = true
	}
}

func (m *mixer) mix(out []float32) {
	clear(out)
	m.mu.Lock()
	for _, input := range m.inputs {
		if !input.primed {
			continue
		}
		count := min(len(input.samples), len(out))
		for index := range count {
			out[index] += input.samples[index]
		}
		input.samples = input.samples[:copy(input.samples, input.samples[count:])]
		if count < len(out) {
			input.primed = false
		}
	}
	m.mu.Unlock()
	for index, value := range out {
		out[index] = sanitizeSample(value)
	}
}

func encodeFloat32(samples []float32, dst []byte) []byte {
	dst = dst[:0]
	for _, value := range samples {
		dst = binary.LittleEndian.AppendUint32(dst, math.Float32bits(value))
	}
	return dst
}

func (m *mixer) run(ctx context.Context, w io.Writer) error {
	if err := writeAudioHeader(w, mixFormat); err != nil {
		return fmt.Errorf("write audio header: %w", err)
	}
	frame := make([]float32, mixFrameSamples)
	buffer := make([]byte, 0, mixFrameSamples*4)
	ticker := time.NewTicker(mixFrameDuration)
	defer ticker.Stop()
	start := time.Now()
	var emitted int64
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
		due := int64(time.Since(start) / mixFrameDuration)
		if due-emitted > mixMaxCatchUp {
			emitted = due - 1
		}
		for emitted < due {
			m.mix(frame)
			buffer = encodeFloat32(frame, buffer)
			if err := writeAll(w, buffer); err != nil {
				return fmt.Errorf("write audio frame: %w", err)
			}
			emitted++
		}
	}
}

type runningSource struct {
	mixKey string
	cancel context.CancelFunc
	done   chan struct{}
}

type sourceSet struct {
	mixer      *mixer
	mu         sync.Mutex
	running    map[string]*runningSource
	failedAt   map[string]time.Time
	generation int
	now        func() time.Time
}

func newSourceSet(m *mixer) *sourceSet {
	return &sourceSet{
		mixer:    m,
		running:  make(map[string]*runningSource),
		failedAt: make(map[string]time.Time),
		now:      time.Now,
	}
}

func (s *sourceSet) reconcile(ctx context.Context, desired []source) {
	wanted := make(map[string]source, len(desired))
	for _, src := range desired {
		wanted[src.key()] = src
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	for key, running := range s.running {
		if _, ok := wanted[key]; ok {
			continue
		}
		log.Printf("stopping audio source %s", key)
		running.cancel()
		s.mixer.remove(running.mixKey)
		delete(s.running, key)
	}
	for key := range s.failedAt {
		if _, ok := wanted[key]; !ok {
			delete(s.failedAt, key)
		}
	}
	for key, src := range wanted {
		if _, ok := s.running[key]; ok {
			continue
		}
		if failedAt, ok := s.failedAt[key]; ok && s.now().Sub(failedAt) < sourceRetryDelay {
			continue
		}
		delete(s.failedAt, key)
		s.start(ctx, key, src)
	}
}

func (s *sourceSet) start(ctx context.Context, key string, src source) {
	s.generation++
	sourceCtx, cancel := context.WithCancel(ctx)
	running := &runningSource{
		mixKey: fmt.Sprintf("%s#%d", key, s.generation),
		cancel: cancel,
		done:   make(chan struct{}),
	}
	s.running[key] = running
	s.mixer.add(running.mixKey)
	log.Printf("starting audio source %s", key)
	go func() {
		defer close(running.done)
		err := src.run(sourceCtx, func(samples []float32) {
			s.mixer.push(running.mixKey, samples)
		})
		s.finished(sourceCtx, key, running, err)
	}()
}

func (s *sourceSet) finished(ctx context.Context, key string, running *runningSource, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.running[key] != running {
		return
	}
	delete(s.running, key)
	s.mixer.remove(running.mixKey)
	defer running.cancel()
	if ctx.Err() != nil {
		return
	}
	s.failedAt[key] = s.now()
	if err != nil {
		log.Printf("audio source %s failed: %v", key, err)
	} else {
		log.Printf("audio source %s ended", key)
	}
}

func (s *sourceSet) keys() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	keys := make([]string, 0, len(s.running))
	for key := range s.running {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func (s *sourceSet) stopAll() {
	s.mu.Lock()
	running := make([]*runningSource, 0, len(s.running))
	for key, item := range s.running {
		item.cancel()
		s.mixer.remove(item.mixKey)
		running = append(running, item)
		delete(s.running, key)
	}
	s.mu.Unlock()
	for _, item := range running {
		<-item.done
	}
}

func runMixedCapture(ctx context.Context, w io.Writer, interval time.Duration, scan func() ([]source, error)) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	m := newMixer()
	sources := newSourceSet(m)
	defer sources.stopAll()

	mixErr := make(chan error, 1)
	go func() {
		mixErr <- m.run(ctx, w)
		cancel()
	}()

	refresh := func() {
		desired, err := scan()
		if err != nil {
			log.Printf("audio source scan failed: %v", err)
			return
		}
		sources.reconcile(ctx, desired)
	}
	refresh()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			select {
			case err := <-mixErr:
				return err
			default:
				return nil
			}
		case <-ticker.C:
			refresh()
		}
	}
}
