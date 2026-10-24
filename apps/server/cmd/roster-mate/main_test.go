package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/simonpratt/roster-mate/apps/server/internal/api"
	"github.com/simonpratt/roster-mate/apps/server/internal/config"
	"github.com/simonpratt/roster-mate/apps/server/internal/extract"
	"github.com/simonpratt/roster-mate/apps/server/internal/extract/fakeanthropic"
	"github.com/simonpratt/roster-mate/apps/server/internal/store"
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
		return st, api.NewRouter(app, a, st, nil, api.Options{})
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

// app is a server booted through run() for one test, with a client that signs in.
type app struct {
	base   string
	c      *http.Client
	stderr *syncBuffer
}

// syncBuffer is a bytes.Buffer the server can log into while the test reads it.
type syncBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}

// startApp boots run() on an ephemeral port with the required settings plus extra, and stops
// it when the test ends.
func startApp(t *testing.T, extra map[string]string) *app {
	t.Helper()
	env := map[string]string{
		"APP_USERNAME":      "simon",
		"APP_PASSWORD":      "secret",
		"ANTHROPIC_API_KEY": "sk-test",
		"ROSTER_NAME":       "Simon P",
		"DATA_DIR":          t.TempDir(),
		"PORT":              "0",
	}
	for k, v := range extra {
		env[k] = v
	}
	ctx, cancel := context.WithCancel(context.Background())
	addrc := make(chan net.Addr, 1)
	codec := make(chan int, 1)
	stderr := &syncBuffer{}
	go func() {
		codec <- run(ctx, func(k string) string { return env[k] }, stderr, func(a net.Addr) { addrc <- a })
	}()
	a := &app{c: &http.Client{Transport: &http.Transport{Proxy: nil}}, stderr: stderr}
	select {
	case addr := <-addrc:
		a.base = fmt.Sprintf("http://127.0.0.1:%d", addr.(*net.TCPAddr).Port)
	case code := <-codec:
		cancel()
		t.Fatalf("run = %d before listening, stderr %q", code, stderr.String())
	case <-time.After(10 * time.Second):
		cancel()
		t.Fatal("run didn't start listening")
	}
	t.Cleanup(func() {
		cancel()
		select {
		case code := <-codec:
			if code != 0 {
				t.Errorf("run = %d after cancel, stderr %q", code, stderr.String())
			}
		case <-time.After(15 * time.Second):
			t.Error("run didn't stop")
		}
	})
	return a
}

// do sends a request, with cookie when it isn't nil, and returns the status and body.
func (a *app) do(t *testing.T, method, path, contentType string, body io.Reader, cookie *http.Cookie) (int, []byte) {
	t.Helper()
	req, err := http.NewRequest(method, a.base+path, body)
	if err != nil {
		t.Fatal(err)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	res, err := a.c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res.StatusCode, b
}

func (a *app) login(t *testing.T) *http.Cookie {
	t.Helper()
	res, err := a.c.Post(a.base+"/api/login", "application/json", strings.NewReader(`{"username":"simon","password":"secret"}`))
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNoContent || len(res.Cookies()) != 1 {
		t.Fatalf("POST /api/login = %s with %d cookies", res.Status, len(res.Cookies()))
	}
	return res.Cookies()[0]
}

type syncResult struct {
	Rev          int64            `json:"rev"`
	Shifts       []map[string]any `json:"shifts"`
	Events       []map[string]any `json:"events"`
	Babysitters  []map[string]any `json:"babysitters"`
	ShiftChanges []map[string]any `json:"shiftChanges"`
}

func (a *app) sync(t *testing.T, cookie *http.Cookie, body string) syncResult {
	t.Helper()
	status, b := a.do(t, "POST", "/api/sync", "application/json", strings.NewReader(body), cookie)
	if status != http.StatusOK {
		t.Fatalf("POST /api/sync = %d %s", status, b)
	}
	var r syncResult
	if err := json.Unmarshal(b, &r); err != nil {
		t.Fatal(err)
	}
	return r
}

const seed = `{"since":0,
	"changes":[{"date":"2026-12-08","code":"D","editedAt":1000}],
	"events":[{"id":"0b6f3e1c-2f4a-4c1d-9e8b-1a2b3c4d5e6f","date":"2026-12-08","text":"Dentist","createdAt":100,"editedAt":1000}],
	"babysitters":[{"date":"2026-12-08","name":"Nan","editedAt":1000}]}`

// With APP_TEST_MODE=1, POST /api/test/reset needs no session, empties shifts, shift changes,
// events and babysitters, and leaves sessions working.
func TestResetInTestMode(t *testing.T) {
	a := startApp(t, map[string]string{"APP_TEST_MODE": "1"})
	if !strings.Contains(a.stderr.String(), "test mode is on") {
		t.Errorf("no test mode warning at startup:\n%s", a.stderr.String())
	}
	cookie := a.login(t)
	if r := a.sync(t, cookie, seed); len(r.Shifts) != 1 || len(r.Events) != 1 || len(r.Babysitters) != 1 || len(r.ShiftChanges) != 1 {
		t.Fatalf("seed sync = %+v", r)
	}

	if status, b := a.do(t, "POST", "/api/test/reset", "", nil, nil); status != http.StatusNoContent {
		t.Fatalf("POST /api/test/reset = %d %s; want 204", status, b)
	}

	r := a.sync(t, cookie, `{"since":0}`)
	if len(r.Shifts)+len(r.Events)+len(r.Babysitters)+len(r.ShiftChanges) != 0 {
		t.Errorf("sync after reset = %+v; want no shifts, shift changes, events or babysitters", r)
	}
	if status, _ := a.do(t, "GET", "/api/session", "", nil, cookie); status != http.StatusOK {
		t.Errorf("GET /api/session with the old cookie after reset = %d; want 200", status)
	}
}

// Without test mode the reset route doesn't exist: even signed in it is the usual /api/ 404,
// and the data stays.
func TestResetIsNotFoundWithoutTestMode(t *testing.T) {
	a := startApp(t, nil)
	if strings.Contains(a.stderr.String(), "test mode") {
		t.Errorf("test mode warning without APP_TEST_MODE:\n%s", a.stderr.String())
	}
	cookie := a.login(t)
	a.sync(t, cookie, seed)

	if status, b := a.do(t, "POST", "/api/test/reset", "", nil, cookie); status != http.StatusNotFound {
		t.Errorf("POST /api/test/reset = %d %s; want 404", status, b)
	}
	if status, _ := a.do(t, "POST", "/api/test/reset", "", nil, nil); status == http.StatusNoContent {
		t.Error("POST /api/test/reset without a session = 204; want it refused")
	}
	r := a.sync(t, cookie, `{"since":0}`)
	if len(r.Shifts) != 1 || r.Shifts[0]["date"] != "2026-12-08" || r.Shifts[0]["code"] != "D" {
		t.Errorf("shifts after the attempted reset = %+v; want the saved one", r.Shifts)
	}
}

// An import through the shared fake Claude, wired by ANTHROPIC_BASE_URL, returns the fixture.
func TestExtractThroughTheFake(t *testing.T) {
	fake := fakeanthropic.New("sk-ant-e2e")
	upstream := httptest.NewServer(fake)
	defer upstream.Close()
	a := startApp(t, map[string]string{"ANTHROPIC_BASE_URL": upstream.URL, "ANTHROPIC_API_KEY": "sk-ant-e2e"})
	cookie := a.login(t)

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	part, _ := mw.CreateFormFile("image", "roster.jpg")
	part.Write([]byte("\xff\xd8\xff\xe0\x00\x10JFIF\x00roster"))
	mw.Close()
	status, b := a.do(t, "POST", "/api/extract", mw.FormDataContentType(), &body, cookie)
	if status != http.StatusOK {
		t.Fatalf("POST /api/extract = %d %s", status, b)
	}
	var res extract.Result
	if err := json.Unmarshal(b, &res); err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, s := range res.Shifts {
		got = append(got, s.Date+" "+*s.Code)
	}
	want := []string{"2026-12-08 D", "2026-12-09 E", "2026-12-10 N", "2026-12-11 X", "2026-12-12 SE"}
	if !res.PersonFound || fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("extract = %+v, shifts %q; want %q", res, got, want)
	}

	reqs := fake.Requests()
	if len(reqs) != 1 || reqs[0].Method != "POST" || reqs[0].Path != "/v1/messages" || reqs[0].Images != 1 {
		t.Errorf("fake requests = %+v; want one POST /v1/messages with one image", reqs)
	}
	if strings.Contains(a.stderr.String(), "sk-ant-e2e") {
		t.Errorf("the API key reached the log:\n%s", a.stderr.String())
	}
}

// RESEND_API_KEY turns email on: the startup log says so without the key, the session reports
// it and /api/recipients is mounted. Without the key the log says email=off and the route is a 404.
func TestRunEmailSwitch(t *testing.T) {
	on := startApp(t, map[string]string{"RESEND_API_KEY": "re_secret_key", "EMAIL_FROM": "Roster <roster@example.com>"})
	off := startApp(t, nil)
	for _, tc := range []struct {
		name    string
		a       *app
		log     string
		session string
		status  int
	}{
		{"on", on, "email=on", `{"username":"simon","email":true}`, http.StatusOK},
		{"off", off, "email=off", `{"username":"simon","email":false}`, http.StatusNotFound},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if !strings.Contains(tc.a.stderr.String(), tc.log) {
				t.Errorf("startup log lacks %s:\n%s", tc.log, tc.a.stderr.String())
			}
			cookie := tc.a.login(t)
			if status, b := tc.a.do(t, "GET", "/api/session", "", nil, cookie); status != http.StatusOK || strings.TrimSpace(string(b)) != tc.session {
				t.Errorf("GET /api/session = %d %s; want %s", status, b, tc.session)
			}
			if status, b := tc.a.do(t, "GET", "/api/recipients", "", nil, cookie); status != tc.status {
				t.Errorf("GET /api/recipients = %d %s; want %d", status, b, tc.status)
			}
		})
	}
	if strings.Contains(on.stderr.String(), "re_secret_key") {
		t.Errorf("the Resend key reached the log:\n%s", on.stderr.String())
	}
}
