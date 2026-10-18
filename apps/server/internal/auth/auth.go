// Package auth handles the single account's login and session cookie (docs/design.md
// § Authentication). A session is an HMAC-SHA256-signed cookie holding the username and an
// expiry; the server keeps no session list.
package auth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

const (
	// CookieName is the session cookie's name.
	CookieName = "rm_session"
	// Lifetime is how long a session lasts from its last use.
	Lifetime = 90 * 24 * time.Hour
	// renewBelow: a valid cookie with less than this left is reissued, so an active phone
	// stays signed in indefinitely without a Set-Cookie on every response.
	renewBelow = Lifetime - 24*time.Hour
	// FailDelay is how long a failed login waits before answering (crude brute-force damping).
	FailDelay = time.Second
)

// Auth checks credentials and issues and verifies session cookies.
type Auth struct {
	username string
	password string
	key      []byte
	// Now and FailDelay are replaceable in tests.
	Now       func() time.Time
	FailDelay time.Duration
}

// New returns an Auth for the configured account, signing cookies with key.
func New(username, password string, key []byte) *Auth {
	return &Auth{username: username, password: password, key: key, Now: time.Now, FailDelay: FailDelay}
}

// session is the signed cookie payload.
type session struct {
	Username  string `json:"username"`
	ExpiresAt int64  `json:"expiresAt"` // unix seconds
}

type ctxKey struct{}

// Username returns the signed-in username that Middleware put in the request context.
func Username(ctx context.Context) string {
	s, _ := ctx.Value(ctxKey{}).(string)
	return s
}

// CheckCredentials reports whether username and password match the account. Both are compared
// in constant time, over their SHA-256 digests so lengths don't leak either.
func (a *Auth) CheckCredentials(username, password string) bool {
	uOK := constantTimeEqual(username, a.username)
	pOK := constantTimeEqual(password, a.password)
	return uOK&pOK == 1
}

func constantTimeEqual(got, want string) int {
	g, w := sha256.Sum256([]byte(got)), sha256.Sum256([]byte(want))
	return subtle.ConstantTimeCompare(g[:], w[:])
}

// SetSession writes a fresh session cookie for the account to w.
func (a *Auth) SetSession(w http.ResponseWriter, r *http.Request) {
	exp := a.Now().Add(Lifetime)
	payload, _ := json.Marshal(session{Username: a.username, ExpiresAt: exp.Unix()})
	value := enc(payload) + "." + enc(a.sign(payload))
	http.SetCookie(w, a.cookie(r, value, int(Lifetime/time.Second)))
}

// ClearSession writes an expired session cookie to w.
func (a *Auth) ClearSession(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, a.cookie(r, "", -1))
}

func (a *Auth) cookie(r *http.Request, value string, maxAge int) *http.Cookie {
	return &http.Cookie{
		Name:     CookieName,
		Value:    value,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		Secure:   r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https"),
	}
}

var errInvalid = errors.New("invalid session")

// verify returns the session in r's cookie if it is signed with the key, names the account
// and has not expired.
func (a *Auth) verify(r *http.Request) (session, error) {
	c, err := r.Cookie(CookieName)
	if err != nil {
		return session{}, errInvalid
	}
	p, sig, ok := strings.Cut(c.Value, ".")
	if !ok {
		return session{}, errInvalid
	}
	payload, err1 := dec(p)
	mac, err2 := dec(sig)
	if err1 != nil || err2 != nil || !hmac.Equal(mac, a.sign(payload)) {
		return session{}, errInvalid
	}
	var s session
	if err := json.Unmarshal(payload, &s); err != nil {
		return session{}, errInvalid
	}
	if s.Username != a.username || !a.Now().Before(time.Unix(s.ExpiresAt, 0)) {
		return session{}, errInvalid
	}
	return s, nil
}

// Middleware lets a request through only with a valid session cookie, answering 401
// {"error":"unauthorized"} otherwise. A cookie with less than 89 days left is reissued, so the
// 90-day lifetime runs from the last use.
func (a *Auth) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s, err := a.verify(r)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(`{"error":"unauthorized"}` + "\n"))
			return
		}
		if time.Unix(s.ExpiresAt, 0).Sub(a.Now()) < renewBelow {
			a.SetSession(w, r)
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, s.Username)))
	})
}

func (a *Auth) sign(payload []byte) []byte {
	m := hmac.New(sha256.New, a.key)
	m.Write(payload)
	return m.Sum(nil)
}

func enc(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func dec(s string) ([]byte, error) { return base64.RawURLEncoding.DecodeString(s) }
