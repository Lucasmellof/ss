package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"sort"
	"strconv"
	"strings"
)

type filterMode string

const (
	filterAll     filterMode = "all"
	filterInclude filterMode = "include"
	filterExclude filterMode = "exclude"

	maxLineageDepth = 64
)

type options struct {
	pid            uint32
	hwnd           uint64
	screen         bool
	excludeDiscord bool
	mode           filterMode
	apps           []string
	selfPID        uint32
	list           bool
}

func parseOptions(args []string, output io.Writer) (options, error) {
	var opts options
	flags := flag.NewFlagSet("audio-loopback", flag.ContinueOnError)
	flags.SetOutput(output)
	pid := flags.Uint("pid", 0, "process ID whose audio tree is captured")
	flags.Uint64Var(&opts.hwnd, "hwnd", 0, "window handle whose process audio is captured")
	flags.BoolVar(&opts.screen, "screen", false, "capture the whole system while excluding Discord")
	flags.BoolVar(&opts.excludeDiscord, "exclude-discord", false, "exclude the Discord process tree")
	mode := flags.String("mode", "", "app filter mode: all, include or exclude")
	flags.Func("app", "application name used by the filter (repeatable)", func(value string) error {
		name := normalizeAppName(value)
		if name == "" {
			return errors.New("empty application name")
		}
		opts.apps = append(opts.apps, name)
		return nil
	})
	selfPID := flags.Uint("self-pid", 0, "process ID of the calling app, always excluded with its children")
	flags.BoolVar(&opts.list, "list", false, "print the applications that currently have audio sessions as JSON")
	if err := flags.Parse(args); err != nil {
		return options{}, err
	}
	if flags.NArg() > 0 {
		return options{}, fmt.Errorf("unexpected arguments: %s", strings.Join(flags.Args(), " "))
	}
	switch filterMode(*mode) {
	case "", filterAll, filterInclude, filterExclude:
		opts.mode = filterMode(*mode)
	default:
		return options{}, fmt.Errorf("invalid mode %q", *mode)
	}
	if *pid > 0xffffffff || *selfPID > 0xffffffff {
		return options{}, errors.New("process ID out of range")
	}
	opts.pid = uint32(*pid)
	opts.selfPID = uint32(*selfPID)
	return opts, nil
}

func (o options) filter() filterConfig {
	mode := o.mode
	if mode == "" {
		mode = filterAll
	}
	apps := make(map[string]bool, len(o.apps))
	for _, app := range o.apps {
		apps[app] = true
	}
	return filterConfig{mode: mode, apps: apps, selfPID: o.selfPID}
}

func baseName(value string) string {
	value = strings.TrimSpace(strings.ReplaceAll(value, `\`, "/"))
	if index := strings.LastIndex(value, "/"); index >= 0 {
		value = value[index+1:]
	}
	return strings.TrimSpace(value)
}

func displayAppName(value string) string {
	value = baseName(value)
	if strings.HasSuffix(strings.ToLower(value), ".exe") {
		value = value[:len(value)-4]
	}
	return strings.TrimSpace(value)
}

func normalizeAppName(value string) string {
	return strings.ToLower(displayAppName(value))
}

type processInfo struct {
	pid    uint32
	parent uint32
	name   string
}

type processTree map[uint32]processInfo

func (t processTree) lineage(pid uint32) []uint32 {
	var chain []uint32
	seen := make(map[uint32]bool)
	for pid != 0 && !seen[pid] && len(chain) < maxLineageDepth {
		seen[pid] = true
		chain = append(chain, pid)
		info, ok := t[pid]
		if !ok {
			break
		}
		pid = info.parent
	}
	return chain
}

func (t processTree) descendsFrom(pid, root uint32) bool {
	if root == 0 {
		return false
	}
	for _, ancestor := range t.lineage(pid) {
		if ancestor == root {
			return true
		}
	}
	return false
}

func collapseToRoots(pids []uint32, tree processTree) []uint32 {
	set := make(map[uint32]bool, len(pids))
	for _, pid := range pids {
		set[pid] = true
	}
	var roots []uint32
	for pid := range set {
		covered := false
		for _, ancestor := range tree.lineage(pid)[1:] {
			if set[ancestor] {
				covered = true
				break
			}
		}
		if !covered {
			roots = append(roots, pid)
		}
	}
	sort.Slice(roots, func(i, j int) bool { return roots[i] < roots[j] })
	return roots
}

type filterConfig struct {
	mode    filterMode
	apps    map[string]bool
	selfPID uint32
}

type audioSession struct {
	pid   uint32
	exe   string
	label string
	names []string
}

func (c filterConfig) isSelf(pid uint32, tree processTree) bool {
	return c.selfPID != 0 && (pid == c.selfPID || tree.descendsFrom(pid, c.selfPID))
}

func (c filterConfig) matchesName(name string) bool {
	normalized := normalizeAppName(name)
	return normalized != "" && c.apps[normalized]
}

func (c filterConfig) matches(session audioSession, tree processTree) bool {
	if c.matchesName(session.exe) {
		return true
	}
	for _, name := range session.names {
		if c.matchesName(name) {
			return true
		}
	}
	for _, ancestor := range tree.lineage(session.pid) {
		if info, ok := tree[ancestor]; ok && c.matchesName(info.name) {
			return true
		}
	}
	return false
}

func (c filterConfig) wants(session audioSession, tree processTree) bool {
	if c.isSelf(session.pid, tree) {
		return false
	}
	switch c.mode {
	case filterInclude:
		return c.matches(session, tree)
	case filterExclude:
		return !c.matches(session, tree)
	default:
		return true
	}
}

func (c filterConfig) topmostMatch(session audioSession, tree processTree) uint32 {
	root := session.pid
	for _, ancestor := range tree.lineage(session.pid) {
		if info, ok := tree[ancestor]; ok && c.matchesName(info.name) {
			root = ancestor
		}
	}
	return root
}

type loopbackKind int

const (
	loopbackDevice loopbackKind = iota
	loopbackInclude
	loopbackExclude
)

type loopbackTarget struct {
	kind loopbackKind
	pid  uint32
}

func (t loopbackTarget) key() string {
	switch t.kind {
	case loopbackInclude:
		return "include:" + strconv.FormatUint(uint64(t.pid), 10)
	case loopbackExclude:
		return "exclude:" + strconv.FormatUint(uint64(t.pid), 10)
	default:
		return "device"
	}
}

func planLoopbackTargets(cfg filterConfig, sessions []audioSession, tree processTree) []loopbackTarget {
	if cfg.mode == filterAll || cfg.mode == "" {
		if cfg.selfPID != 0 {
			return []loopbackTarget{{kind: loopbackExclude, pid: cfg.selfPID}}
		}
		return []loopbackTarget{{kind: loopbackDevice}}
	}

	excludedRoots := make(map[uint32]bool)
	if cfg.selfPID != 0 {
		excludedRoots[cfg.selfPID] = true
	}
	var candidates []uint32
	for _, session := range sessions {
		if session.pid == 0 || cfg.isSelf(session.pid, tree) {
			continue
		}
		matched := cfg.matches(session, tree)
		if cfg.mode == filterExclude && matched {
			excludedRoots[cfg.topmostMatch(session, tree)] = true
		}
		if cfg.wants(session, tree) {
			candidates = append(candidates, session.pid)
		}
	}

	if cfg.mode == filterExclude && len(excludedRoots) <= 1 {
		for root := range excludedRoots {
			return []loopbackTarget{{kind: loopbackExclude, pid: root}}
		}
		return []loopbackTarget{{kind: loopbackDevice}}
	}

	safe := candidates[:0]
	for _, pid := range candidates {
		if !containsExcludedRoot(pid, excludedRoots, tree) {
			safe = append(safe, pid)
		}
	}
	var targets []loopbackTarget
	for _, pid := range collapseToRoots(safe, tree) {
		targets = append(targets, loopbackTarget{kind: loopbackInclude, pid: pid})
	}
	return targets
}

func containsExcludedRoot(pid uint32, excludedRoots map[uint32]bool, tree processTree) bool {
	for root := range excludedRoots {
		if tree.descendsFrom(root, pid) {
			return true
		}
	}
	return false
}

type audioApp struct {
	PID  uint32 `json:"pid"`
	Name string `json:"name"`
	Exe  string `json:"exe"`
}

func buildAppList(cfg filterConfig, sessions []audioSession, tree processTree) []audioApp {
	apps := make([]audioApp, 0, len(sessions))
	seen := make(map[string]bool)
	for _, session := range sessions {
		if cfg.isSelf(session.pid, tree) {
			continue
		}
		key := normalizeAppName(session.exe)
		if key == "" {
			continue
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		name := strings.TrimSpace(session.label)
		if name == "" {
			name = displayAppName(session.exe)
		}
		apps = append(apps, audioApp{PID: session.pid, Name: name, Exe: baseName(session.exe)})
	}
	sort.Slice(apps, func(i, j int) bool {
		return strings.ToLower(apps[i].Name) < strings.ToLower(apps[j].Name)
	})
	return apps
}

func writeAppList(w io.Writer, apps []audioApp) error {
	if apps == nil {
		apps = []audioApp{}
	}
	return json.NewEncoder(w).Encode(apps)
}

func printAppList(cfg filterConfig, sessions []audioSession, tree processTree) int {
	if err := writeAppList(os.Stdout, buildAppList(cfg, sessions, tree)); err != nil {
		fmt.Fprintf(os.Stderr, "write application list: %v\n", err)
		return 1
	}
	return 0
}
