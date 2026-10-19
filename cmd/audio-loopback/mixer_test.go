package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"math"
	"sync"
	"testing"
	"time"
)

func constantSamples(value float32, count int) []float32 {
	samples := make([]float32, count)
	for index := range samples {
		samples[index] = value
	}
	return samples
}

func TestMixerSumsPrimedInputs(t *testing.T) {
	m := newMixer()
	m.add("a")
	m.add("b")
	m.push("a", constantSamples(0.25, mixPrimeSamples))
	m.push("b", constantSamples(0.5, mixPrimeSamples))

	out := make([]float32, mixFrameSamples)
	m.mix(out)
	for index, value := range out {
		if math.Abs(float64(value-0.75)) > 1e-6 {
			t.Fatalf("sample %d = %v, want 0.75", index, value)
		}
	}
}

func TestMixerClampsOutput(t *testing.T) {
	m := newMixer()
	m.add("a")
	m.add("b")
	m.push("a", constantSamples(0.8, mixPrimeSamples))
	m.push("b", constantSamples(-0.3, mixPrimeSamples/2))
	m.push("b", constantSamples(0.9, mixPrimeSamples/2))

	out := make([]float32, mixFrameSamples)
	m.mix(out)
	m.mix(out)
	for index, value := range out {
		if value != 1 {
			t.Fatalf("sample %d = %v, want clamp to 1", index, value)
		}
	}
}

func TestMixerWaitsForPrimeAndFillsSilenceOnUnderrun(t *testing.T) {
	m := newMixer()
	m.add("a")
	out := make([]float32, mixFrameSamples)

	m.push("a", constantSamples(0.5, mixFrameSamples))
	m.mix(out)
	if out[0] != 0 {
		t.Fatalf("unprimed input was mixed: %v", out[0])
	}

	m.push("a", constantSamples(0.5, mixFrameSamples+mixFrameSamples/2))
	m.mix(out)
	if out[0] != 0.5 {
		t.Fatalf("primed input not mixed: %v", out[0])
	}
	m.mix(out)
	if out[mixFrameSamples-1] != 0.5 {
		t.Fatalf("buffered input not mixed: %v", out[mixFrameSamples-1])
	}
	m.mix(out)
	if out[0] != 0.5 || out[mixFrameSamples/2-1] != 0.5 {
		t.Fatalf("remaining samples not mixed: %v", out[0])
	}
	if out[mixFrameSamples/2] != 0 || out[mixFrameSamples-1] != 0 {
		t.Fatalf("underrun not filled with silence")
	}

	m.push("a", constantSamples(0.5, mixFrameSamples))
	m.mix(out)
	if out[0] != 0 {
		t.Fatalf("input should re-prime after an underrun")
	}
}

func TestMixerBoundsBufferedAudio(t *testing.T) {
	m := newMixer()
	m.add("a")
	m.push("a", constantSamples(0.1, mixMaxSamples))
	m.push("a", constantSamples(0.2, mixFrameSamples+2))
	m.mu.Lock()
	buffered := len(m.inputs["a"].samples)
	last := m.inputs["a"].samples[buffered-1]
	m.mu.Unlock()
	if buffered > mixMaxSamples || buffered%mixChannels != 0 {
		t.Fatalf("buffered %d samples", buffered)
	}
	if last != 0.2 {
		t.Fatalf("newest samples were dropped")
	}
}

func TestMixerIgnoresUnknownInputs(t *testing.T) {
	m := newMixer()
	m.push("missing", constantSamples(1, mixPrimeSamples))
	out := make([]float32, mixFrameSamples)
	m.mix(out)
	if out[0] != 0 {
		t.Fatalf("unknown input was mixed")
	}
}

type syncBuffer struct {
	mu     sync.Mutex
	buffer bytes.Buffer
}

func (b *syncBuffer) Write(data []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buffer.Write(data)
}

func (b *syncBuffer) Bytes() []byte {
	b.mu.Lock()
	defer b.mu.Unlock()
	return append([]byte(nil), b.buffer.Bytes()...)
}

func TestMixerRunWritesHeaderAndFrames(t *testing.T) {
	m := newMixer()
	output := &syncBuffer{}
	ctx, cancel := context.WithTimeout(context.Background(), 80*time.Millisecond)
	defer cancel()
	if err := m.run(ctx, output); err != nil {
		t.Fatalf("run: %v", err)
	}
	data := output.Bytes()
	if !bytes.Equal(data[:16], encodeAudioHeader(mixFormat)) {
		t.Fatalf("unexpected header %v", data[:16])
	}
	if string(data[:4]) != "SSAF" || data[5] != audioSampleFloat32 || data[6] != 2 {
		t.Fatalf("header fields wrong: %v", data[:16])
	}
	if binary.LittleEndian.Uint32(data[8:12]) != 48000 || binary.LittleEndian.Uint16(data[12:14]) != 8 {
		t.Fatalf("header rate or block align wrong: %v", data[:16])
	}
	payload := len(data) - 16
	if payload == 0 || payload%(mixFrameSamples*4) != 0 {
		t.Fatalf("payload of %d bytes is not whole frames", payload)
	}
}

type fakeSource struct {
	name    string
	value   float32
	fail    bool
	started chan struct{}
}

func (f *fakeSource) key() string {
	return f.name
}

func (f *fakeSource) run(ctx context.Context, sink func([]float32)) error {
	if f.started != nil {
		close(f.started)
	}
	if f.fail {
		return errors.New("boom")
	}
	sink(constantSamples(f.value, mixPrimeSamples))
	<-ctx.Done()
	return nil
}

func waitFor(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("condition not reached")
}

func TestSourceSetReconcile(t *testing.T) {
	m := newMixer()
	set := newSourceSet(m)
	ctx := context.Background()
	defer set.stopAll()

	a := &fakeSource{name: "a", value: 0.25, started: make(chan struct{})}
	b := &fakeSource{name: "b", value: 0.25, started: make(chan struct{})}
	set.reconcile(ctx, []source{a, b})
	<-a.started
	<-b.started
	if keys := set.keys(); len(keys) != 2 || keys[0] != "a" || keys[1] != "b" {
		t.Fatalf("keys = %v", keys)
	}

	out := make([]float32, mixFrameSamples)
	waitFor(t, func() bool {
		m.mix(out)
		return out[0] == 0.5
	})

	set.reconcile(ctx, []source{a})
	if keys := set.keys(); len(keys) != 1 || keys[0] != "a" {
		t.Fatalf("keys after removal = %v", keys)
	}
}

func TestSourceSetBacksOffFailedSources(t *testing.T) {
	m := newMixer()
	set := newSourceSet(m)
	now := time.Unix(1000, 0)
	set.now = func() time.Time { return now }
	ctx := context.Background()
	defer set.stopAll()

	failing := &fakeSource{name: "bad", fail: true, started: make(chan struct{})}
	set.reconcile(ctx, []source{failing})
	<-failing.started
	waitFor(t, func() bool { return len(set.keys()) == 0 })

	retry := &fakeSource{name: "bad", fail: true, started: make(chan struct{})}
	set.reconcile(ctx, []source{retry})
	if len(set.keys()) != 0 {
		t.Fatalf("failed source restarted before the retry delay")
	}

	now = now.Add(sourceRetryDelay)
	set.reconcile(ctx, []source{retry})
	<-retry.started
}

func TestRunMixedCaptureStopsOnWriteError(t *testing.T) {
	err := runMixedCapture(context.Background(), failingWriter{}, time.Hour, func() ([]source, error) {
		return nil, nil
	})
	if err == nil {
		t.Fatal("expected write error")
	}
}

type failingWriter struct{}

func (failingWriter) Write([]byte) (int, error) {
	return 0, errors.New("closed pipe")
}
