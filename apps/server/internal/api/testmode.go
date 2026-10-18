package api

import (
	"log/slog"
	"net/http"

	"github.com/simonpratt/roster-mate/apps/server/internal/store"
)

// WithTestRoutes adds the test-only routes in front of next, outside the session middleware:
// POST /api/test/reset empties shifts, events and babysitters (meta, and so every session,
// survives) and answers 204. The server wraps its router with it only when APP_TEST_MODE=1, so
// without it these paths are the usual /api/ 404.
func WithTestRoutes(next http.Handler, st *store.Store) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/test/reset", func(w http.ResponseWriter, r *http.Request) {
		if err := st.Reset(r.Context()); err != nil {
			slog.Error("test reset", "err", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusNoContent)
	})
	mux.Handle("/", next)
	return mux
}
