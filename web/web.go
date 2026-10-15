package web

import "embed"

// FS contains the browser client served by the Go binary.
//
//go:embed index.html app.js style.css favicon.ico icon.png
var FS embed.FS
