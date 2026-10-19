//go:build darwin

package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Fprintln(os.Stderr, "audio-loopback is not supported on macOS")
	os.Exit(1)
}
