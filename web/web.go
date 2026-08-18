package web

import "embed"

// FS contains the browser client served by the Go binary.
//
//go:embed index.html app.js style.css
var FS embed.FS
