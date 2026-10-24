// Package api wires the HTTP routes: the JSON API under /api/ and the web app everywhere else.
package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/simonpratt/roster-mate/apps/server/internal/auth"
	"github.com/simonpratt/roster-mate/apps/server/internal/extract"
	"github.com/simonpratt/roster-mate/apps/server/internal/store"
)

// Options holds the router's switches from the configuration.
type Options struct {
	// Email turns roster emails on: it mounts /api/recipients and is reported by /api/session.
	Email bool
}

// NewRouter returns the server's handler. app serves the web app for every path outside /api/;
// it and /api/health, /api/login need no session, and every other /api/ route does. ex reads
// shifts from roster photos for /api/extract.
func NewRouter(app http.Handler, a *auth.Auth, st *store.Store, ex extract.Extractor, opts Options) http.Handler {
	private := http.NewServeMux()
	private.HandleFunc("POST /api/logout", logout(a))
	private.HandleFunc("GET /api/session", sessionInfo(opts.Email))
	private.HandleFunc("POST /api/sync", sync(st))
	private.HandleFunc("POST /api/extract", extractShifts(ex))
	if opts.Email {
		private.HandleFunc("GET /api/recipients", getRecipients(st))
		private.HandleFunc("PUT /api/recipients", putRecipients(st))
	}
	// Any other /api/ path is a 404, never the web app's index.html.
	private.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
	})

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", health)
	mux.HandleFunc("POST /api/login", login(a))
	mux.Handle("/api/", a.Middleware(private))
	mux.Handle("/", app)
	return mux
}

func health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

type credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// login answers 204 with a session cookie for the right username and password, and 401 after
// a delay for anything else.
func login(a *auth.Auth) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var c credentials
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&c); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad request"})
			return
		}
		if !a.CheckCredentials(c.Username, c.Password) {
			select {
			case <-time.After(a.FailDelay):
			case <-r.Context().Done():
			}
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		a.SetSession(w, r)
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusNoContent)
	}
}

func logout(a *auth.Auth) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Middleware may have set a renewed cookie; this one replaces it.
		w.Header().Del("Set-Cookie")
		a.ClearSession(w, r)
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusNoContent)
	}
}

type session struct {
	Username string `json:"username"`
	Email    bool   `json:"email"`
}

// sessionInfo answers GET /api/session with the signed-in user and whether roster emails are on.
func sessionInfo(email bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, session{Username: auth.Username(r.Context()), Email: email})
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
