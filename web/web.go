package web

import (
	"embed"
	"io/fs"
)

//go:embed site favicon.ico icon.png
var embedded embed.FS

// FS contains the browser build and its static assets.
var FS, _ = fs.Sub(embedded, "site")

// Icons remain available at the root of the server.
var Icons = embedded
