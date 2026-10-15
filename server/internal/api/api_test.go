package api

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/simonpratt/roster-mate/server/internal/auth"
	"github.com/simonpratt/roster-mate/server/internal/web"
)

const indexHTML = `<!doctype html><html class="dark"><div id="root"></div></html>`

func newServer(t *testing.T) *httptest.Server {
	t.Helper()
	srv, _ := newAuthServer(t)
	return srv
}

// newAuthServer returns a server for account simon/secret whose Auth has no failed-login delay
// and a clock the test can move.
func newAuthServer(t *testing.T) (*httptest.Server, *auth.Auth) {
	t.Helper()
	app := web.Handler(fstest.MapFS{
		"index.html":       {Data: []byte(indexHTML)},
		"assets/app-1a.js": {Data: []byte(`console.log(1)`)},
	})
	a := auth.New("simon", "secret", []byte("0123456789abcdef0123456789abcdef"))
	a.FailDelay = 0
	srv := httptest.NewServer(NewRouter(app, a, newStore(t)))
	t.Cleanup(srv.Close)
	return srv, a
}

func get(t *testing.T, url string) (*http.Response, string) {
	t.Helper()
	res, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	return res, string(body)
}

func TestHealth(t *testing.T) {
	srv := newServer(t)
	res, body := get(t, srv.URL+"/api/health")
	if res.StatusCode != 200 || strings.TrimSpace(body) != `{"ok":true}` {
		t.Errorf("GET /api/health = %d %q", res.StatusCode, body)
	}
	if ct := res.Header.Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q", ct)
	}
}

func TestUnknownAPIPathIs404(t *testing.T) {
	srv := newServer(t)
	c := loginCookie(t, srv.URL)
	for _, p := range []string{"/api/foo", "/api/", "/api/health/extra"} {
		res, body := do(t, "GET", srv.URL+p, "", c)
		if res.StatusCode != 404 || strings.Contains(body, "<html") {
			t.Errorf("GET %s = %d %q, want a JSON 404", p, res.StatusCode, body)
		}
	}
}

func TestWebAppAndFallback(t *testing.T) {
	srv := newServer(t)
	for _, p := range []string{"/", "/foo", "/import", "/index.html", "/assets/missing.js"} {
		res, body := get(t, srv.URL+p)
		if res.StatusCode != 200 || body != indexHTML {
			t.Errorf("GET %s = %d %q, want index.html", p, res.StatusCode, body)
		}
	}
	res, body := get(t, srv.URL+"/assets/app-1a.js")
	if res.StatusCode != 200 || body != `console.log(1)` {
		t.Errorf("GET asset = %d %q", res.StatusCode, body)
	}
	if cc := res.Header.Get("Cache-Control"); !strings.Contains(cc, "immutable") {
		t.Errorf("asset Cache-Control = %q", cc)
	}
}
