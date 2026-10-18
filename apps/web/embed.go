// Package web embeds the built React client (dist/, from `pnpm build`) so the Go server can serve
// it from the binary. go:embed can't reach outside its package directory, so the client embeds
// itself and apps/server imports it. In a fresh clone dist/ holds only .gitkeep, which keeps
// this compiling; the server then answers / with 503 "web app not built".
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// Dist returns the built web app, rooted at dist/.
func Dist() fs.FS {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		panic(err) // the directory is embedded at compile time
	}
	return sub
}
