// Package web serves the built frontend (web/dist, copied into ./dist before go build) from the
// binary, with an SPA fallback to index.html.
package web

import (
	"embed"
	"errors"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// dist holds the built web app. The Makefile and Dockerfile copy web/dist here before go build;
// in a fresh checkout it holds only .gitkeep and the handler reports that the app isn't built.
//
//go:embed all:dist
var dist embed.FS

// Dist returns the embedded build of the web app.
func Dist() fs.FS {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		panic(err) // the directory is embedded at compile time
	}
	return sub
}

// Handler serves files from fsys. A GET or HEAD for a path that isn't a file gets index.html,
// so client-side routes such as /import load the app. Mount it outside /api/.
func Handler(fsys fs.FS) http.Handler {
	files := http.FileServerFS(fsys)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if name != "" && name != "index.html" && isFile(fsys, name) {
			if strings.HasPrefix(name, "assets/") {
				// Vite puts a content hash in every file name under assets/.
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			files.ServeHTTP(w, r)
			return
		}
		serveIndex(w, r, fsys)
	})
}

func serveIndex(w http.ResponseWriter, r *http.Request, fsys fs.FS) {
	body, err := fs.ReadFile(fsys, "index.html")
	if errors.Is(err, fs.ErrNotExist) {
		http.Error(w, "web app not built: run `make build` or `make dev`", http.StatusServiceUnavailable)
		return
	}
	if err != nil {
		http.Error(w, "read index.html", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	if r.Method == http.MethodHead {
		return
	}
	w.Write(body)
}

func isFile(fsys fs.FS, name string) bool {
	info, err := fs.Stat(fsys, name)
	return err == nil && !info.IsDir()
}
