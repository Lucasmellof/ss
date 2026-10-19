package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

type sinkInput struct {
	index  uint32
	pid    uint32
	binary string
	name   string
}

func (s sinkInput) session() audioSession {
	exe := s.binary
	if exe == "" {
		exe = s.name
	}
	var names []string
	if s.name != "" {
		names = append(names, s.name)
	}
	return audioSession{pid: s.pid, exe: exe, label: s.name, names: names}
}

func parseUint32(value string) uint32 {
	parsed, err := strconv.ParseUint(strings.TrimSpace(value), 10, 32)
	if err != nil {
		return 0
	}
	return uint32(parsed)
}

func sinkInputFromProperties(index uint32, properties map[string]string) sinkInput {
	return sinkInput{
		index:  index,
		pid:    parseUint32(properties["application.process.id"]),
		binary: strings.TrimSpace(properties["application.process.binary"]),
		name:   strings.TrimSpace(properties["application.name"]),
	}
}

func parsePactlJSON(data []byte) ([]sinkInput, error) {
	var raw []struct {
		Index      json.Number    `json:"index"`
		Properties map[string]any `json:"properties"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("parse pactl JSON: %w", err)
	}
	inputs := make([]sinkInput, 0, len(raw))
	for _, item := range raw {
		index, err := strconv.ParseUint(item.Index.String(), 10, 32)
		if err != nil {
			continue
		}
		properties := make(map[string]string, len(item.Properties))
		for key, value := range item.Properties {
			switch typed := value.(type) {
			case string:
				properties[key] = typed
			case json.Number:
				properties[key] = typed.String()
			case float64:
				properties[key] = strconv.FormatFloat(typed, 'f', -1, 64)
			}
		}
		inputs = append(inputs, sinkInputFromProperties(uint32(index), properties))
	}
	sortSinkInputs(inputs)
	return inputs, nil
}

func parsePactlText(data string) []sinkInput {
	var inputs []sinkInput
	var properties map[string]string
	var index uint32
	inBlock := false
	flush := func() {
		if inBlock {
			inputs = append(inputs, sinkInputFromProperties(index, properties))
		}
	}
	scanner := bufio.NewScanner(strings.NewReader(data))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if rest, ok := strings.CutPrefix(line, "Sink Input #"); ok {
			flush()
			parsed, err := strconv.ParseUint(strings.TrimSpace(rest), 10, 32)
			inBlock = err == nil
			index = uint32(parsed)
			properties = make(map[string]string)
			continue
		}
		if !inBlock {
			continue
		}
		key, value, ok := strings.Cut(line, " = ")
		if !ok {
			continue
		}
		properties[strings.TrimSpace(key)] = strings.Trim(strings.TrimSpace(value), `"`)
	}
	flush()
	sortSinkInputs(inputs)
	return inputs
}

func sortSinkInputs(inputs []sinkInput) {
	sort.Slice(inputs, func(i, j int) bool { return inputs[i].index < inputs[j].index })
}

func parseProcStat(stat string) (parent uint32, name string, ok bool) {
	open := strings.IndexByte(stat, '(')
	closing := strings.LastIndexByte(stat, ')')
	if open < 0 || closing < open {
		return 0, "", false
	}
	fields := strings.Fields(stat[closing+1:])
	if len(fields) < 2 {
		return 0, "", false
	}
	parentPID, err := strconv.ParseUint(fields[1], 10, 32)
	if err != nil {
		return 0, "", false
	}
	return uint32(parentPID), stat[open+1 : closing], true
}

func planSinkInputs(cfg filterConfig, inputs []sinkInput, tree processTree) []sinkInput {
	var targets []sinkInput
	for _, input := range inputs {
		if cfg.wants(input.session(), tree) {
			targets = append(targets, input)
		}
	}
	return targets
}
