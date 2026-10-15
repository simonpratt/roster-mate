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
