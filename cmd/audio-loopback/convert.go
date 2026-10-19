package main

import (
	"encoding/binary"
	"fmt"
	"io"
	"math"
)

const (
	audioSampleFloat32 = 1
	audioSamplePCM     = 2
	audioStreamVersion = 1

	mixSampleRate = 48000
	mixChannels   = 2
)

type audioFormatInfo struct {
	sampleKind byte
	channels   byte
	sampleRate uint32
	blockAlign uint16
	bits       byte
	validBits  byte
}

var mixFormat = audioFormatInfo{
	sampleKind: audioSampleFloat32,
	channels:   mixChannels,
	sampleRate: mixSampleRate,
	blockAlign: mixChannels * 4,
	bits:       32,
	validBits:  32,
}

func writeAll(w io.Writer, data []byte) error {
	for len(data) > 0 {
		written, err := w.Write(data)
		if err != nil {
			return err
		}
		if written == 0 {
			return fmt.Errorf("write returned zero bytes")
		}
		data = data[written:]
	}
	return nil
}

func encodeAudioHeader(info audioFormatInfo) []byte {
	header := make([]byte, 16)
	copy(header[:4], "SSAF")
	header[4] = audioStreamVersion
	header[5] = info.sampleKind
	header[6] = info.channels
	binary.LittleEndian.PutUint32(header[8:12], info.sampleRate)
	binary.LittleEndian.PutUint16(header[12:14], info.blockAlign)
	header[14] = info.bits
	header[15] = info.validBits
	return header
}

func writeAudioHeader(w io.Writer, info audioFormatInfo) error {
	return writeAll(w, encodeAudioHeader(info))
}

func decodeSample(data []byte, kind byte, bits byte) float32 {
	if kind == audioSampleFloat32 {
		return math.Float32frombits(binary.LittleEndian.Uint32(data))
	}
	switch bits {
	case 8:
		return float32(int(data[0])-128) / 128
	case 16:
		return float32(int16(binary.LittleEndian.Uint16(data))) / 32768
	case 24:
		value := int32(uint32(data[0]) | uint32(data[1])<<8 | uint32(data[2])<<16)
		if value&0x800000 != 0 {
			value |= ^0xffffff
		}
		return float32(value) / 8388608
	case 32:
		return float32(int32(binary.LittleEndian.Uint32(data))) / 2147483648
	}
	return 0
}

func decodeStereo(info audioFormatInfo, data []byte, dst []float32) []float32 {
	if info.channels == 0 || info.blockAlign == 0 {
		return dst
	}
	sampleBytes := int(info.blockAlign) / int(info.channels)
	if sampleBytes == 0 || (info.sampleKind == audioSampleFloat32 && sampleBytes < 4) {
		return dst
	}
	frames := len(data) / int(info.blockAlign)
	for frame := range frames {
		base := frame * int(info.blockAlign)
		left := decodeSample(data[base:base+sampleBytes], info.sampleKind, info.bits)
		right := left
		if info.channels > 1 {
			offset := base + sampleBytes
			right = decodeSample(data[offset:offset+sampleBytes], info.sampleKind, info.bits)
		}
		dst = append(dst, sanitizeSample(left), sanitizeSample(right))
	}
	return dst
}

func sanitizeSample(value float32) float32 {
	switch {
	case value != value:
		return 0
	case value > 1:
		return 1
	case value < -1:
		return -1
	}
	return value
}

type linearResampler struct {
	inRate  int
	outRate int
	pos     float64
	last    [mixChannels]float32
}

func newLinearResampler(inRate, outRate int) *linearResampler {
	return &linearResampler{inRate: inRate, outRate: outRate}
}

func (r *linearResampler) process(in []float32, dst []float32) []float32 {
	if r.inRate == r.outRate || r.inRate <= 0 || r.outRate <= 0 {
		return append(dst, in...)
	}
	frames := len(in) / mixChannels
	if frames == 0 {
		return dst
	}
	step := float64(r.inRate) / float64(r.outRate)
	sample := func(index, channel int) float32 {
		if index < 0 {
			return r.last[channel]
		}
		return in[index*mixChannels+channel]
	}
	for r.pos < float64(frames-1) {
		index := int(math.Floor(r.pos))
		fraction := float32(r.pos - float64(index))
		for channel := range mixChannels {
			current := sample(index, channel)
			next := sample(index+1, channel)
			dst = append(dst, current+(next-current)*fraction)
		}
		r.pos += step
	}
	r.pos -= float64(frames)
	for channel := range mixChannels {
		r.last[channel] = in[(frames-1)*mixChannels+channel]
	}
	return dst
}

type stereoConverter struct {
	info      audioFormatInfo
	resampler *linearResampler
	decoded   []float32
	remainder []byte
}

func newStereoConverter(info audioFormatInfo) *stereoConverter {
	return &stereoConverter{
		info:      info,
		resampler: newLinearResampler(int(info.sampleRate), mixSampleRate),
	}
}

func (c *stereoConverter) convert(data []byte) []float32 {
	if len(c.remainder) > 0 {
		data = append(c.remainder, data...)
		c.remainder = nil
	}
	block := int(c.info.blockAlign)
	if block == 0 {
		return nil
	}
	usable := len(data) - len(data)%block
	if usable < len(data) {
		c.remainder = append([]byte(nil), data[usable:]...)
	}
	c.decoded = decodeStereo(c.info, data[:usable], c.decoded[:0])
	return c.resampler.process(c.decoded, nil)
}
