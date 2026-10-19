package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"io/fs"
	"net/http"
	"path"
	"regexp"
	"strings"
	"time"
)

var shellCandidates = []string{"_shell.html", "index.html"}

var inlineScriptPattern = regexp.MustCompile(`(?is)<script\b([^>]*)>(.*?)</script>`)

type spaHandler struct {
	files   fs.FS
	static  http.Handler
	shell   []byte
	scripts []string
}

func newSPAHandler(files fs.FS, fallback string) *spaHandler {
	h := &spaHandler{files: files, static: http.FileServer(http.FS(files)), shell: []byte(fallback)}
	for _, name := range shellCandidates {
		content, err := fs.ReadFile(files, name)
		if err == nil && len(content) > 0 {
			h.shell = content
			break
		}
	}
	h.scripts = inlineScriptHashes(h.shell)
	return h
}

func inlineScriptHashes(html []byte) []string {
	var hashes []string
	for _, match := range inlineScriptPattern.FindAllSubmatch(html, -1) {
		if bytes.Contains(bytes.ToLower(match[1]), []byte("src=")) || len(match[2]) == 0 {
			continue
		}
		sum := sha256.Sum256(normalizeScriptText(match[2]))
		hashes = append(hashes, "sha256-"+base64.StdEncoding.EncodeToString(sum[:]))
	}
	return hashes
}

func normalizeScriptText(script []byte) []byte {
	script = bytes.ReplaceAll(script, []byte("\r\n"), []byte("\n"))
	script = bytes.ReplaceAll(script, []byte("\r"), []byte("\n"))
	script = bytes.ReplaceAll(script, []byte{0}, []byte("�"))
	return bytes.ToValidUTF8(script, []byte("�"))
}

func (h *spaHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
		return
	}
	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name != "" && !hiddenPath(name) && !isShell(name) {
		if info, err := fs.Stat(h.files, name); err == nil && !info.IsDir() {
			if strings.HasPrefix(name, "assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			h.static.ServeHTTP(w, r)
			return
		}
		if strings.HasPrefix(name, "assets/") {
			http.NotFound(w, r)
			return
		}
	}
	h.serveShell(w, r)
}

func (h *spaHandler) serveShell(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeContent(w, r, "", time.Time{}, bytes.NewReader(h.shell))
}

func hiddenPath(name string) bool {
	for _, part := range strings.Split(name, "/") {
		if strings.HasPrefix(part, ".") {
			return true
		}
	}
	return false
}

func isShell(name string) bool {
	for _, candidate := range shellCandidates {
		if name == candidate {
			return true
		}
	}
	return false
}
