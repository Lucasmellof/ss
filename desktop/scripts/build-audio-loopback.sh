#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
output_path="$repository_root/desktop/build/audio-loopback"
executable_path="$output_path/audio-loopback"

if ! command -v go >/dev/null 2>&1; then
	echo "Go was not found. Install Go 1.23 or newer to build the audio helper." >&2
	exit 1
fi

mkdir -p "$output_path"
(
	cd "$repository_root"
	CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags "-s -w" -o "$executable_path" ./cmd/audio-loopback
)
chmod +x "$executable_path"
echo "Audio helper built at $executable_path"
