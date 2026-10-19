package main

import (
	"bytes"
	"encoding/binary"
	"io"
	"math"
	"reflect"
	"strings"
	"testing"
)

func TestNormalizeAppName(t *testing.T) {
	cases := map[string]string{
		"Discord.exe":                        "discord",
		"  Spotify.EXE ":                     "spotify",
		`C:\Program Files\Google\chrome.exe`: "chrome",
		"/usr/lib/firefox/firefox":           "firefox",
		"vlc":                                "vlc",
		"":                                   "",
	}
	for input, want := range cases {
		if got := normalizeAppName(input); got != want {
			t.Errorf("normalizeAppName(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestParseOptions(t *testing.T) {
	opts, err := parseOptions([]string{"--mode", "exclude", "--app", "Discord.exe", "--app", "spotify", "--self-pid", "42"}, io.Discard)
	if err != nil {
		t.Fatalf("parseOptions: %v", err)
	}
	if opts.mode != filterExclude || opts.selfPID != 42 || !reflect.DeepEqual(opts.apps, []string{"discord", "spotify"}) {
		t.Fatalf("unexpected options %+v", opts)
	}
	cfg := opts.filter()
	if !cfg.apps["discord"] || !cfg.apps["spotify"] || cfg.selfPID != 42 {
		t.Fatalf("unexpected filter %+v", cfg)
	}

	legacy, err := parseOptions([]string{"--hwnd", "1234", "--exclude-discord"}, io.Discard)
	if err != nil || legacy.hwnd != 1234 || !legacy.excludeDiscord || legacy.mode != "" {
		t.Fatalf("legacy flags not parsed: %+v %v", legacy, err)
	}
	if legacy.filter().mode != filterAll {
		t.Fatalf("default filter mode should be all")
	}

	for _, args := range [][]string{{"--mode", "bogus"}, {"--app", " "}, {"extra"}} {
		if _, err := parseOptions(args, io.Discard); err == nil {
			t.Errorf("parseOptions(%v) should fail", args)
		}
	}
}

func sampleTree() processTree {
	return processTree{
		1:   {pid: 1, parent: 0, name: "explorer.exe"},
		10:  {pid: 10, parent: 1, name: "ScreenShare.exe"},
		11:  {pid: 11, parent: 10, name: "ScreenShare.exe"},
		20:  {pid: 20, parent: 1, name: "Discord.exe"},
		21:  {pid: 21, parent: 20, name: "Discord.exe"},
		30:  {pid: 30, parent: 1, name: "chrome.exe"},
		31:  {pid: 31, parent: 30, name: "chrome.exe"},
		40:  {pid: 40, parent: 1, name: "Spotify.exe"},
		50:  {pid: 50, parent: 1, name: "steam.exe"},
		51:  {pid: 51, parent: 50, name: "game.exe"},
		100: {pid: 100, parent: 100, name: "loop.exe"},
	}
}

func sampleSessions(tree processTree, pids ...uint32) []audioSession {
	sessions := make([]audioSession, 0, len(pids))
	for _, pid := range pids {
		sessions = append(sessions, audioSession{pid: pid, exe: tree[pid].name})
	}
	return sessions
}

func TestProcessTreeLineage(t *testing.T) {
	tree := sampleTree()
	if got := tree.lineage(21); !reflect.DeepEqual(got, []uint32{21, 20, 1}) {
		t.Fatalf("lineage(21) = %v", got)
	}
	if got := tree.lineage(100); !reflect.DeepEqual(got, []uint32{100}) {
		t.Fatalf("self-parented lineage = %v", got)
	}
	if !tree.descendsFrom(11, 10) || tree.descendsFrom(21, 10) || tree.descendsFrom(1, 0) {
		t.Fatal("descendsFrom mismatch")
	}
}

func TestFilterMatchesParentChain(t *testing.T) {
	tree := sampleTree()
	cfg := filterConfig{mode: filterExclude, apps: map[string]bool{"steam": true}, selfPID: 10}
	if !cfg.matches(audioSession{pid: 51, exe: "game.exe"}, tree) {
		t.Fatal("child of a filtered app should match")
	}
	if cfg.matches(audioSession{pid: 40, exe: "Spotify.exe"}, tree) {
		t.Fatal("unrelated app should not match")
	}
	if !cfg.matches(audioSession{pid: 999, exe: "unknown", names: []string{"Steam"}}, tree) {
		t.Fatal("extra names should match")
	}
	if !cfg.isSelf(11, tree) || cfg.wants(audioSession{pid: 11, exe: "ScreenShare.exe"}, tree) {
		t.Fatal("self tree must never be wanted")
	}
}

func TestPlanAllModeExcludesSelf(t *testing.T) {
	tree := sampleTree()
	cfg := filterConfig{mode: filterAll, selfPID: 10}
	got := planLoopbackTargets(cfg, sampleSessions(tree, 11, 21, 31), tree)
	if !reflect.DeepEqual(got, []loopbackTarget{{kind: loopbackExclude, pid: 10}}) {
		t.Fatalf("plan = %v", got)
	}
	got = planLoopbackTargets(filterConfig{mode: filterAll}, nil, tree)
	if !reflect.DeepEqual(got, []loopbackTarget{{kind: loopbackDevice}}) {
		t.Fatalf("plan without self = %v", got)
	}
}

func TestPlanIncludeMode(t *testing.T) {
	tree := sampleTree()
	cfg := filterConfig{mode: filterInclude, apps: map[string]bool{"chrome": true, "screenshare": true}, selfPID: 10}
	got := planLoopbackTargets(cfg, sampleSessions(tree, 11, 21, 30, 31, 40), tree)
	want := []loopbackTarget{{kind: loopbackInclude, pid: 30}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("plan = %v, want %v", got, want)
	}
	if got := planLoopbackTargets(cfg, sampleSessions(tree, 40), tree); len(got) != 0 {
		t.Fatalf("plan without matches = %v", got)
	}
}

func TestPlanExcludeModeUsesNativeExcludeForSingleTree(t *testing.T) {
	tree := sampleTree()
	cfg := filterConfig{mode: filterExclude, apps: map[string]bool{"discord": true}, selfPID: 10}
	got := planLoopbackTargets(cfg, sampleSessions(tree, 11, 31, 40), tree)
	if !reflect.DeepEqual(got, []loopbackTarget{{kind: loopbackExclude, pid: 10}}) {
		t.Fatalf("plan = %v", got)
	}

	noSelf := filterConfig{mode: filterExclude, apps: map[string]bool{"discord": true}}
	got = planLoopbackTargets(noSelf, sampleSessions(tree, 21, 31), tree)
	if !reflect.DeepEqual(got, []loopbackTarget{{kind: loopbackExclude, pid: 20}}) {
		t.Fatalf("plan without self = %v", got)
	}
}

func TestPlanExcludeModeMixesRemainingApps(t *testing.T) {
	tree := sampleTree()
	cfg := filterConfig{mode: filterExclude, apps: map[string]bool{"discord": true}, selfPID: 10}
	got := planLoopbackTargets(cfg, sampleSessions(tree, 1, 11, 21, 31, 40, 51), tree)
	want := []loopbackTarget{
		{kind: loopbackInclude, pid: 31},
		{kind: loopbackInclude, pid: 40},
		{kind: loopbackInclude, pid: 51},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("plan = %v, want %v", got, want)
	}
}

func TestBuildAppList(t *testing.T) {
	tree := sampleTree()
	cfg := filterConfig{mode: filterAll, selfPID: 10}
	apps := buildAppList(cfg, sampleSessions(tree, 11, 21, 30, 31, 40), tree)
	want := []audioApp{
		{PID: 30, Name: "chrome", Exe: "chrome.exe"},
		{PID: 21, Name: "Discord", Exe: "Discord.exe"},
		{PID: 40, Name: "Spotify", Exe: "Spotify.exe"},
	}
	if !reflect.DeepEqual(apps, want) {
		t.Fatalf("apps = %+v, want %+v", apps, want)
	}

	var buffer bytes.Buffer
	if err := writeAppList(&buffer, nil); err != nil || strings.TrimSpace(buffer.String()) != "[]" {
		t.Fatalf("empty list encoded as %q (%v)", buffer.String(), err)
	}
	buffer.Reset()
	if err := writeAppList(&buffer, want[:1]); err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(buffer.String()) != `[{"pid":30,"name":"chrome","exe":"chrome.exe"}]` {
		t.Fatalf("unexpected JSON %s", buffer.String())
	}
}

func TestDecodeStereoFormats(t *testing.T) {
	pcm16Mono := audioFormatInfo{sampleKind: audioSamplePCM, channels: 1, sampleRate: 48000, blockAlign: 2, bits: 16}
	data := make([]byte, 4)
	binary.LittleEndian.PutUint16(data[0:], uint16(int16(16384)))
	binary.LittleEndian.PutUint16(data[2:], uint16(0x8000))
	got := decodeStereo(pcm16Mono, data, nil)
	if !reflect.DeepEqual(got, []float32{0.5, 0.5, -1, -1}) {
		t.Fatalf("pcm16 mono = %v", got)
	}

	float6 := audioFormatInfo{sampleKind: audioSampleFloat32, channels: 6, sampleRate: 48000, blockAlign: 24, bits: 32}
	frame := make([]byte, 24)
	for channel := range 6 {
		binary.LittleEndian.PutUint32(frame[channel*4:], math.Float32bits(float32(channel)/10))
	}
	got = decodeStereo(float6, frame, nil)
	if len(got) != 2 || got[0] != 0 || math.Abs(float64(got[1]-0.1)) > 1e-6 {
		t.Fatalf("float 5.1 = %v", got)
	}

	pcm24 := audioFormatInfo{sampleKind: audioSamplePCM, channels: 2, sampleRate: 48000, blockAlign: 6, bits: 24}
	got = decodeStereo(pcm24, []byte{0x00, 0x00, 0x40, 0x00, 0x00, 0xc0}, nil)
	if !reflect.DeepEqual(got, []float32{0.5, -0.5}) {
		t.Fatalf("pcm24 = %v", got)
	}
}

func TestStereoConverterKeepsPartialFrames(t *testing.T) {
	converter := newStereoConverter(mixFormat)
	frame := make([]byte, 8)
	binary.LittleEndian.PutUint32(frame[0:], math.Float32bits(0.25))
	binary.LittleEndian.PutUint32(frame[4:], math.Float32bits(-0.25))
	if got := converter.convert(frame[:5]); len(got) != 0 {
		t.Fatalf("partial frame produced %v", got)
	}
	if got := converter.convert(frame[5:]); !reflect.DeepEqual(got, []float32{0.25, -0.25}) {
		t.Fatalf("completed frame = %v", got)
	}
}

func TestLinearResamplerRate(t *testing.T) {
	resampler := newLinearResampler(44100, 48000)
	var out []float32
	input := make([]float32, 441*2)
	for frame := range 441 {
		input[frame*2] = 0.5
		input[frame*2+1] = -0.5
	}
	for range 100 {
		out = resampler.process(input, out)
	}
	frames := len(out) / 2
	if frames < 47990 || frames > 48010 {
		t.Fatalf("resampled to %d frames, want about 48000", frames)
	}
	for index, value := range out {
		want := float32(0.5)
		if index%2 == 1 {
			want = -0.5
		}
		if math.Abs(float64(value-want)) > 1e-6 {
			t.Fatalf("sample %d = %v, want %v", index, value, want)
		}
	}
}

func TestParsePactlJSON(t *testing.T) {
	data := []byte(`[
		{"index": 7, "corked": false, "properties": {"application.name": "Firefox", "application.process.id": "1234", "application.process.binary": "firefox"}},
		{"index": 3, "properties": {"application.name": "WEBRTC VoiceEngine", "application.process.binary": "Discord"}}
	]`)
	inputs, err := parsePactlJSON(data)
	if err != nil {
		t.Fatal(err)
	}
	want := []sinkInput{
		{index: 3, binary: "Discord", name: "WEBRTC VoiceEngine"},
		{index: 7, pid: 1234, binary: "firefox", name: "Firefox"},
	}
	if !reflect.DeepEqual(inputs, want) {
		t.Fatalf("inputs = %+v", inputs)
	}
	if _, err := parsePactlJSON([]byte("Sink Input #1")); err == nil {
		t.Fatal("expected JSON error")
	}
}

func TestParsePactlText(t *testing.T) {
	text := `Sink Input #42
	Driver: protocol-native.c
	Corked: no
	Properties:
		application.name = "Spotify"
		application.process.id = "555"
		application.process.binary = "spotify"

Sink Input #43
	Properties:
		application.name = "mpv"
`
	inputs := parsePactlText(text)
	want := []sinkInput{
		{index: 42, pid: 555, binary: "spotify", name: "Spotify"},
		{index: 43, name: "mpv"},
	}
	if !reflect.DeepEqual(inputs, want) {
		t.Fatalf("inputs = %+v", inputs)
	}
	if session := inputs[1].session(); session.exe != "mpv" {
		t.Fatalf("session without binary = %+v", session)
	}
}

func TestParseProcStat(t *testing.T) {
	parent, name, ok := parseProcStat("1234 (Web Content (x)) S 99 1234 1234 0 -1")
	if !ok || parent != 99 || name != "Web Content (x)" {
		t.Fatalf("parseProcStat = %d %q %v", parent, name, ok)
	}
	if _, _, ok := parseProcStat("garbage"); ok {
		t.Fatal("expected failure")
	}
}

func TestPlanSinkInputs(t *testing.T) {
	tree := processTree{
		10: {pid: 10, parent: 1, name: "screen-share"},
		11: {pid: 11, parent: 10, name: "screen-share"},
		20: {pid: 20, parent: 1, name: "firefox"},
		30: {pid: 30, parent: 1, name: "spotify"},
	}
	inputs := []sinkInput{
		{index: 1, pid: 11, binary: "screen-share"},
		{index: 2, pid: 20, binary: "firefox", name: "Firefox"},
		{index: 3, pid: 30, binary: "spotify", name: "Spotify"},
	}
	indexes := func(targets []sinkInput) []uint32 {
		var out []uint32
		for _, target := range targets {
			out = append(out, target.index)
		}
		return out
	}
	all := planSinkInputs(filterConfig{mode: filterAll, selfPID: 10}, inputs, tree)
	if got := indexes(all); !reflect.DeepEqual(got, []uint32{2, 3}) {
		t.Fatalf("all = %v", got)
	}
	include := planSinkInputs(filterConfig{mode: filterInclude, apps: map[string]bool{"firefox": true}, selfPID: 10}, inputs, tree)
	if got := indexes(include); !reflect.DeepEqual(got, []uint32{2}) {
		t.Fatalf("include = %v", got)
	}
	exclude := planSinkInputs(filterConfig{mode: filterExclude, apps: map[string]bool{"firefox": true}, selfPID: 10}, inputs, tree)
	if got := indexes(exclude); !reflect.DeepEqual(got, []uint32{3}) {
		t.Fatalf("exclude = %v", got)
	}
}
