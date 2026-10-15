//go:build linux

package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Fprintln(os.Stderr, "AudioLoopback WASAPI é exclusivo do Windows; no Linux use a captura Chromium/PipeWire.")
	os.Exit(1)
}
