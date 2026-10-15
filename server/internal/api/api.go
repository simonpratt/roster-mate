// Package api wires the HTTP routes: the JSON API under /api/ and the web app everywhere else.
package api

import (
	"encoding/json"
	"net/http"
)

// NewRouter returns the server's handler. app serves the web app for every path outside /api/.
func NewRouter(app http.Handler) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", health)
	// Any other /api/ path is a 404, never the web app's index.html.
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
	})
	mux.Handle("/", app)
	return mux
}

func health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
