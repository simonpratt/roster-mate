package web

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func TestNotBuilt(t *testing.T) {
	rec := httptest.NewRecorder()
	Handler(fstest.MapFS{}).ServeHTTP(rec, httptest.NewRequest("GET", "/", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", rec.Code)
	}
}

func TestNonGetIsRejected(t *testing.T) {
	rec := httptest.NewRecorder()
	fsys := fstest.MapFS{"index.html": {Data: []byte("x")}}
	Handler(fsys).ServeHTTP(rec, httptest.NewRequest("POST", "/foo", nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", rec.Code)
	}
}

func TestHeadServesIndexWithoutBody(t *testing.T) {
	rec := httptest.NewRecorder()
	fsys := fstest.MapFS{"index.html": {Data: []byte("<html></html>")}}
	Handler(fsys).ServeHTTP(rec, httptest.NewRequest("HEAD", "/calendar", nil))
	if rec.Code != 200 || rec.Body.Len() != 0 {
		t.Errorf("HEAD = %d with %d bytes", rec.Code, rec.Body.Len())
	}
}

func TestCacheControl(t *testing.T) {
	fsys := fstest.MapFS{
		"index.html":                 {Data: []byte("<html></html>")},
		"sw.js":                      {Data: []byte("sw")},
		"registerSW.js":              {Data: []byte("reg")},
		"manifest.webmanifest":       {Data: []byte("{}")},
		"icons/icon-192.png":         {Data: []byte("png")},
		"assets/index-Cj5pXuDJ.js":   {Data: []byte("js")},
		"assets/font-BWZEU5yA.woff2": {Data: []byte("font")},
	}
	const immutable = "public, max-age=31536000, immutable"
	cases := map[string]string{
		"/":                           "no-cache",
		"/calendar":                   "no-cache",
		"/sw.js":                      "no-cache",
		"/registerSW.js":              "no-cache",
		"/manifest.webmanifest":       "no-cache",
		"/icons/icon-192.png":         "no-cache",
		"/assets/index-Cj5pXuDJ.js":   immutable,
		"/assets/font-BWZEU5yA.woff2": immutable,
	}
	for p, want := range cases {
		rec := httptest.NewRecorder()
		Handler(fsys).ServeHTTP(rec, httptest.NewRequest("GET", p, nil))
		if rec.Code != http.StatusOK {
			t.Errorf("GET %s = %d", p, rec.Code)
		}
		if got := rec.Header().Get("Cache-Control"); got != want {
			t.Errorf("GET %s Cache-Control = %q, want %q", p, got, want)
		}
	}
}
