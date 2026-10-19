//go:build linux

package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"
)

const (
	linuxScanInterval = 2 * time.Second
	pactlTimeout      = 3 * time.Second
)

func main() {
	os.Exit(run(os.Args[1:]))
}

func run(args []string) int {
	opts, err := parseOptions(args, os.Stderr)
	if err != nil {
		log.Printf("invalid arguments: %v", err)
		return 2
	}
	if opts.hwnd != 0 {
		log.Printf("--hwnd is only supported on Windows; using the app filter instead")
	}
	for _, tool := range []string{"pactl", "parec"} {
		if _, err := exec.LookPath(tool); err != nil {
			log.Printf("%s not found; install pulseaudio-utils or pipewire-pulse", tool)
			return 1
		}
	}
	cfg := opts.filter()

	if opts.list {
		inputs, err := listSinkInputs()
		if err != nil {
			log.Printf("list sink inputs: %v", err)
			return 1
		}
		sessions := make([]audioSession, 0, len(inputs))
		for _, input := range inputs {
			sessions = append(sessions, input.session())
		}
		return printAppList(cfg, sessions, readProcessTree())
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	log.Printf("starting PulseAudio capture mode=%s apps=%v selfPID=%d", cfg.mode, opts.apps, cfg.selfPID)
	err = runMixedCapture(ctx, os.Stdout, linuxScanInterval, func() ([]source, error) {
		inputs, err := listSinkInputs()
		if err != nil {
			return nil, err
		}
		targets := planSinkInputs(cfg, inputs, readProcessTree())
		sources := make([]source, 0, len(targets))
		for _, target := range targets {
			sources = append(sources, parecSource{input: target})
		}
		return sources, nil
	})
	if err != nil {
		log.Printf("capture stopped: %v", err)
		return 1
	}
	return 0
}

func listSinkInputs() ([]sinkInput, error) {
	ctx, cancel := context.WithTimeout(context.Background(), pactlTimeout)
	defer cancel()
	output, err := pactl(ctx, "-f", "json", "list", "sink-inputs")
	if err == nil {
		if inputs, parseErr := parsePactlJSON(output); parseErr == nil {
			return inputs, nil
		}
	}
	output, err = pactl(ctx, "list", "sink-inputs")
	if err != nil {
		return nil, err
	}
	return parsePactlText(string(output)), nil
}

func pactl(ctx context.Context, args ...string) ([]byte, error) {
	command := exec.CommandContext(ctx, "pactl", args...)
	command.Env = append(os.Environ(), "LC_ALL=C")
	output, err := command.Output()
	if err != nil {
		return nil, fmt.Errorf("pactl %v: %w", args, err)
	}
	return output, nil
}

func readProcessTree() processTree {
	tree := make(processTree)
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return tree
	}
	for _, entry := range entries {
		pid, err := strconv.ParseUint(entry.Name(), 10, 32)
		if err != nil || !entry.IsDir() {
			continue
		}
		stat, err := os.ReadFile(filepath.Join("/proc", entry.Name(), "stat"))
		if err != nil {
			continue
		}
		parent, name, ok := parseProcStat(string(stat))
		if !ok {
			continue
		}
		if target, err := os.Readlink(filepath.Join("/proc", entry.Name(), "exe")); err == nil {
			name = filepath.Base(target)
		}
		tree[uint32(pid)] = processInfo{pid: uint32(pid), parent: parent, name: name}
	}
	return tree
}

type parecSource struct {
	input sinkInput
}

func (s parecSource) key() string {
	return "sink-input:" + strconv.FormatUint(uint64(s.input.index), 10)
}

func (s parecSource) run(ctx context.Context, sink func([]float32)) error {
	command := exec.CommandContext(
		ctx,
		"parec",
		"--monitor-stream="+strconv.FormatUint(uint64(s.input.index), 10),
		"--format=float32le",
		"--rate="+strconv.Itoa(mixSampleRate),
		"--channels="+strconv.Itoa(mixChannels),
		"--latency-msec=20",
		"--raw",
	)
	command.Stderr = os.Stderr
	stdout, err := command.StdoutPipe()
	if err != nil {
		return fmt.Errorf("parec stdout: %w", err)
	}
	if err := command.Start(); err != nil {
		return fmt.Errorf("start parec: %w", err)
	}
	converter := newStereoConverter(mixFormat)
	buffer := make([]byte, mixFrameSamples*4)
	var readErr error
	for {
		count, err := stdout.Read(buffer)
		if count > 0 {
			sink(converter.convert(buffer[:count]))
		}
		if err != nil {
			if !errors.Is(err, io.EOF) {
				readErr = err
			}
			break
		}
	}
	waitErr := command.Wait()
	if ctx.Err() != nil {
		return nil
	}
	if readErr != nil {
		return fmt.Errorf("read parec: %w", readErr)
	}
	if waitErr != nil {
		return fmt.Errorf("parec exited: %w", waitErr)
	}
	return nil
}
