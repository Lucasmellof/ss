package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// FS contains the browser client served by the Go binary.
var FS = mustSub(dist, "dist")

const FallbackPage = `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Screen Share</title></head>
<body>
<h1>Screen Share</h1>
<p>A interface web não foi incluída neste binário. Rode <code>bun run build:web</code> em <code>desktop/</code> e compile o servidor novamente.</p>
</body>
</html>
`

func mustSub(fsys fs.FS, dir string) fs.FS {
	sub, err := fs.Sub(fsys, dir)
	if err != nil {
		panic(err)
	}
	return sub
}
