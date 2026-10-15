package main

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/simonpratt/roster-mate/server/internal/api"
	"github.com/simonpratt/roster-mate/server/internal/config"
	"github.com/simonpratt/roster-mate/server/internal/store"
)

func TestRunWithoutAppPasswordExitsNonZero(t *testing.T) {
	env := map[string]string{
		"APP_USERNAME":      "simon",
		"ANTHROPIC_API_KEY": "sk-test",
		"ROSTER_NAME":       "Simon P",
		"DATA_DIR":          t.TempDir(),
	}
	var stderr bytes.Buffer
	code := run(context.Background(), func(k string) string { return env[k] }, &stderr)
	if code == 0 {
		t.Fatal("run without APP_PASSWORD returned 0")
	}
	if !strings.Contains(stderr.String(), "APP_PASSWORD") {
		t.Errorf("stderr %q does not name APP_PASSWORD", stderr.String())
	}
}

// Without SESSION_SECRET, a cookie issued before a restart (the same DATA_DIR reopened) still
// signs the user in afterwards.
func TestSessionSurvivesRestartWithoutSessionSecret(t *testing.T) {
	cfg := config.Config{Username: "simon", Password: "secret", DataDir: t.TempDir()}
	app := http.NotFoundHandler()

	start := func() (*store.Store, http.Handler) {
		t.Helper()
		st, err := store.Open(cfg.DataDir)
		if err != nil {
			t.Fatal(err)
		}
		a, err := newAuth(cfg, st)
		if err != nil {
			t.Fatal(err)
		}
		return st, api.NewRouter(app, a)
	}

	st, h := start()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("POST", "/api/login", strings.NewReader(`{"username":"simon","password":"secret"}`)))
	cookies := rec.Result().Cookies()
	if rec.Code != 204 || len(cookies) != 1 {
		t.Fatalf("login = %d with %d cookies", rec.Code, len(cookies))
	}
	st.Close()

	st, h = start()
	defer st.Close()
	req := httptest.NewRequest("GET", "/api/session", nil)
	req.AddCookie(cookies[0])
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("GET /api/session after restart = %d %q, want 200", rec.Code, rec.Body.String())
	}
}

func TestRunStartsAndStops(t *testing.T) {
	env := map[string]string{
		"APP_USERNAME":      "simon",
		"APP_PASSWORD":      "secret",
		"ANTHROPIC_API_KEY": "sk-test",
		"ROSTER_NAME":       "Simon P",
		"DATA_DIR":          t.TempDir(),
		"PORT":              "0",
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var stderr bytes.Buffer
	if code := run(ctx, func(k string) string { return env[k] }, &stderr); code != 0 {
		t.Fatalf("run = %d, stderr %q", code, stderr.String())
	}
}
