package main

import (
	"bytes"
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

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
	code := run(context.Background(), func(k string) string { return env[k] }, &stderr, nil)
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
		return st, api.NewRouter(app, a, st, nil)
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

// The whole boot sequence, through to signing in over real HTTP and shutting down cleanly, runs
// in-process on an ephemeral port.
func TestRunServesAndStops(t *testing.T) {
	env := map[string]string{
		"APP_USERNAME":      "simon",
		"APP_PASSWORD":      "secret",
		"ANTHROPIC_API_KEY": "sk-test",
		"ROSTER_NAME":       "Simon P",
		"DATA_DIR":          t.TempDir(),
		"PORT":              "0",
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	addrc := make(chan net.Addr, 1)
	codec := make(chan int, 1)
	var stderr bytes.Buffer
	go func() {
		codec <- run(ctx, func(k string) string { return env[k] }, &stderr, func(a net.Addr) { addrc <- a })
	}()

	var base string
	select {
	case a := <-addrc:
		// Straight to loopback, never through a proxy from the environment.
		base = fmt.Sprintf("http://127.0.0.1:%d", a.(*net.TCPAddr).Port)
	case code := <-codec:
		t.Fatalf("run = %d before listening, stderr %q", code, stderr.String())
	case <-time.After(10 * time.Second):
		t.Fatal("run didn't start listening")
	}
	c := &http.Client{Transport: &http.Transport{Proxy: nil}}

	res, err := c.Get(base + "/api/health")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Errorf("GET /api/health = %s", res.Status)
	}

	res, err = c.Post(base+"/api/login", "application/json", strings.NewReader(`{"username":"simon","password":"secret"}`))
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNoContent || len(res.Cookies()) != 1 {
		t.Fatalf("POST /api/login = %s with %d cookies", res.Status, len(res.Cookies()))
	}
	req, _ := http.NewRequest("GET", base+"/api/session", nil)
	req.AddCookie(res.Cookies()[0])
	res, err = c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Errorf("GET /api/session = %s", res.Status)
	}

	cancel()
	select {
	case code := <-codec:
		if code != 0 {
			t.Errorf("run = %d after cancel, stderr %q", code, stderr.String())
		}
	case <-time.After(15 * time.Second):
		t.Fatal("run didn't stop")
	}
	if strings.Contains(stderr.String(), "secret") || strings.Contains(stderr.String(), "sk-test") {
		t.Errorf("a secret reached the log:\n%s", stderr.String())
	}
}
