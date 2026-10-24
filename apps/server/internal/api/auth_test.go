package api

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/simonpratt/roster-mate/apps/server/internal/auth"
)

const goodCreds = `{"username":"simon","password":"secret"}`

// do sends a request with an optional JSON body and cookie, without following redirects.
func do(t *testing.T, method, url, body string, c *http.Cookie, headers ...string) (*http.Response, string) {
	t.Helper()
	var rd io.Reader
	if body != "" {
		rd = strings.NewReader(body)
	}
	req, err := http.NewRequest(method, url, rd)
	if err != nil {
		t.Fatal(err)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	if c != nil {
		req.AddCookie(c)
	}
	res, err := http.DefaultTransport.RoundTrip(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res, string(b)
}

// newRouterServer serves the API with a, returning its base URL.
func newRouterServer(t *testing.T, a *auth.Auth) string {
	t.Helper()
	srv := httptest.NewServer(NewRouter(http.NotFoundHandler(), a, newStore(t), nil, Options{}))
	t.Cleanup(srv.Close)
	return srv.URL
}

func sessionCookie(res *http.Response) *http.Cookie {
	for _, c := range res.Cookies() {
		if c.Name == auth.CookieName {
			return c
		}
	}
	return nil
}

func loginCookie(t *testing.T, base string) *http.Cookie {
	t.Helper()
	res, body := do(t, "POST", base+"/api/login", goodCreds, nil)
	c := sessionCookie(res)
	if res.StatusCode != 204 || c == nil {
		t.Fatalf("POST /api/login = %d %q, cookie %v; want 204 with a cookie", res.StatusCode, body, c)
	}
	return c
}

func TestLoginSetsCookieThatOpensSession(t *testing.T) {
	srv, _ := newAuthServer(t)
	c := loginCookie(t, srv.URL)
	if !c.HttpOnly || c.SameSite != http.SameSiteStrictMode || c.Path != "/" || c.MaxAge != 90*24*60*60 {
		t.Errorf("cookie = %+v; want HttpOnly, SameSite=Strict, Path=/, Max-Age 90 days", c)
	}
	res, body := do(t, "GET", srv.URL+"/api/session", "", c)
	if res.StatusCode != 200 || strings.TrimSpace(body) != `{"username":"simon","email":false}` {
		t.Errorf("GET /api/session = %d %q", res.StatusCode, body)
	}
}

func TestWrongCredentialsAre401WithoutCookie(t *testing.T) {
	srv, _ := newAuthServer(t)
	for _, creds := range []string{
		`{"username":"simon","password":"wrong"}`,
		`{"username":"other","password":"secret"}`,
		`{"username":"","password":""}`,
	} {
		res, body := do(t, "POST", srv.URL+"/api/login", creds, nil)
		if res.StatusCode != 401 || sessionCookie(res) != nil {
			t.Errorf("login %s = %d %q, cookie %v; want 401 and no cookie", creds, res.StatusCode, body, sessionCookie(res))
		}
	}
}

func TestFailedLoginWaits(t *testing.T) {
	srv, a := newAuthServer(t)
	a.FailDelay = 200 * time.Millisecond
	start := time.Now()
	res, _ := do(t, "POST", srv.URL+"/api/login", `{"username":"simon","password":"nope"}`, nil)
	if res.StatusCode != 401 || time.Since(start) < a.FailDelay {
		t.Errorf("failed login = %d after %v; want 401 after at least %v", res.StatusCode, time.Since(start), a.FailDelay)
	}
}

func TestMissingTamperedAndExpiredCookiesAre401(t *testing.T) {
	srv, a := newAuthServer(t)
	good := loginCookie(t, srv.URL)

	payload, sig, _ := strings.Cut(good.Value, ".")
	flipped := []byte(sig)
	flipped[0] ^= 1
	if flipped[0] == sig[0] {
		t.Fatal("tamper did not change the signature")
	}
	otherKey := auth.New("simon", "secret", []byte("another-key-another-key-another!!"))
	foreign := loginCookie(t, newRouterServer(t, otherKey))

	cases := map[string]*http.Cookie{
		"missing":          nil,
		"garbage":          {Name: auth.CookieName, Value: "nonsense"},
		"tampered sig":     {Name: auth.CookieName, Value: payload + "." + string(flipped)},
		"tampered payload": {Name: auth.CookieName, Value: "eyJ1c2VybmFtZSI6InNpbW9uIiwiZXhwaXJlc0F0Ijo5OTk5OTk5OTk5fQ." + sig},
		"other key":        foreign,
	}
	for name, c := range cases {
		res, body := do(t, "GET", srv.URL+"/api/session", "", c)
		if res.StatusCode != 401 || strings.TrimSpace(body) != `{"error":"unauthorized"}` {
			t.Errorf("%s: GET /api/session = %d %q; want 401 unauthorized", name, res.StatusCode, body)
		}
	}

	// Ninety days and a second later the same cookie has expired.
	a.Now = func() time.Time { return time.Now().Add(auth.Lifetime + time.Second) }
	if res, body := do(t, "GET", srv.URL+"/api/session", "", good); res.StatusCode != 401 {
		t.Errorf("expired: GET /api/session = %d %q; want 401", res.StatusCode, body)
	}
}

func TestPublicRoutesNeedNoCookie(t *testing.T) {
	srv, _ := newAuthServer(t)
	for _, p := range []string{"/api/health", "/", "/login", "/assets/app-1a.js"} {
		if res, body := do(t, "GET", srv.URL+p, "", nil); res.StatusCode != 200 {
			t.Errorf("GET %s without a cookie = %d %q; want 200", p, res.StatusCode, body)
		}
	}
	for _, r := range []struct{ method, path string }{
		{"GET", "/api/session"}, {"POST", "/api/logout"}, {"GET", "/api/nope"},
	} {
		if res, _ := do(t, r.method, srv.URL+r.path, "", nil); res.StatusCode != 401 {
			t.Errorf("%s %s without a cookie = %d; want 401", r.method, r.path, res.StatusCode)
		}
	}
}

func TestCookieSecureOnlyBehindHTTPS(t *testing.T) {
	srv, _ := newAuthServer(t)
	res, _ := do(t, "POST", srv.URL+"/api/login", goodCreds, nil)
	if c := sessionCookie(res); c == nil || c.Secure {
		t.Errorf("plain HTTP: cookie %+v; want one without Secure", c)
	}
	res, _ = do(t, "POST", srv.URL+"/api/login", goodCreds, nil, "X-Forwarded-Proto", "https")
	if c := sessionCookie(res); c == nil || !c.Secure {
		t.Errorf("X-Forwarded-Proto https: cookie %+v; want Secure", c)
	}
}

func TestSessionRenewsAfterADay(t *testing.T) {
	srv, a := newAuthServer(t)
	c := loginCookie(t, srv.URL)

	res, _ := do(t, "GET", srv.URL+"/api/session", "", c)
	if sessionCookie(res) != nil {
		t.Error("fresh cookie was reissued; want no Set-Cookie within the first day")
	}

	later := time.Now().Add(30 * 24 * time.Hour)
	a.Now = func() time.Time { return later }
	res, _ = do(t, "GET", srv.URL+"/api/session", "", c)
	renewed := sessionCookie(res)
	if res.StatusCode != 200 || renewed == nil || renewed.MaxAge != 90*24*60*60 {
		t.Fatalf("30 days in: %d, cookie %+v; want 200 and a renewed 90-day cookie", res.StatusCode, renewed)
	}
	// The renewed cookie outlives the original one.
	a.Now = func() time.Time { return later.Add(89 * 24 * time.Hour) }
	if res, _ := do(t, "GET", srv.URL+"/api/session", "", renewed); res.StatusCode != 200 {
		t.Errorf("renewed cookie 119 days after login = %d; want 200", res.StatusCode)
	}
}

func TestLogoutExpiresCookie(t *testing.T) {
	srv, _ := newAuthServer(t)
	c := loginCookie(t, srv.URL)
	res, _ := do(t, "POST", srv.URL+"/api/logout", "", c)
	cleared := sessionCookie(res)
	if res.StatusCode != 204 || cleared == nil || cleared.MaxAge >= 0 || cleared.Value != "" {
		t.Errorf("POST /api/logout = %d, cookie %+v; want 204 and an expired cookie", res.StatusCode, cleared)
	}
}

func TestLoginRejectsMalformedBody(t *testing.T) {
	srv, _ := newAuthServer(t)
	if res, _ := do(t, "POST", srv.URL+"/api/login", "not json", nil); res.StatusCode != 400 || sessionCookie(res) != nil {
		t.Errorf("malformed login = %d; want 400 and no cookie", res.StatusCode)
	}
}
