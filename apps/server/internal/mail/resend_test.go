package mail

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/simonpratt/roster-mate/apps/server/internal/mail/fakeresend"
)

var msg = Message{From: "Roster <roster@example.com>", To: "nan@example.com", Subject: "New roster", HTML: "<p>hi</p>", Text: "hi"}

// The request is POST /emails with the bearer key, a JSON body of from, to [address], subject,
// html and text, and a roster-mate User-Agent.
func TestResendRequestShape(t *testing.T) {
	var method, path, auth, ctype, ua string
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		method, path = r.Method, r.URL.Path
		auth, ctype, ua = r.Header.Get("Authorization"), r.Header.Get("Content-Type"), r.Header.Get("User-Agent")
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &body)
		w.Write([]byte(`{"id":"1"}`))
	}))
	defer srv.Close()

	if err := NewResend(srv.URL+"/", "re_key").Send(context.Background(), msg); err != nil {
		t.Fatal(err)
	}
	if method != "POST" || path != "/emails" || auth != "Bearer re_key" || ctype != "application/json" || ua != "roster-mate" {
		t.Errorf("request = %s %s, auth %q, type %q, UA %q", method, path, auth, ctype, ua)
	}
	want := map[string]any{"from": msg.From, "to": []any{msg.To}, "subject": msg.Subject, "html": msg.HTML, "text": msg.Text}
	gotJSON, _ := json.Marshal(body)
	wantJSON, _ := json.Marshal(want)
	if string(gotJSON) != string(wantJSON) {
		t.Errorf("body = %s; want %s", gotJSON, wantJSON)
	}
}

// A non-2xx answer is an error naming the status only, never the body, key or address.
func TestResendNon2xxIsAnErrorWithoutTheBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity)
		w.Write([]byte(`{"message":"secret-body-detail"}`))
	}))
	defer srv.Close()
	err := NewResend(srv.URL, "re_key").Send(context.Background(), msg)
	if err == nil {
		t.Fatal("422 gave no error")
	}
	if got := err.Error(); got != "resend: status 422" {
		t.Errorf("error = %q; want %q", got, "resend: status 422")
	}
}

// Against the shared fake: the right key is accepted and recorded, a wrong one is a 401 error.
func TestResendAgainstTheFake(t *testing.T) {
	fake := fakeresend.New("re_key")
	srv := httptest.NewServer(fake)
	defer srv.Close()
	if err := NewResend(srv.URL, "re_key").Send(context.Background(), msg); err != nil {
		t.Fatal(err)
	}
	if err := NewResend(srv.URL, "re_wrong").Send(context.Background(), msg); err == nil || strings.Contains(err.Error(), "re_wrong") || !strings.Contains(err.Error(), "401") {
		t.Errorf("wrong key error = %v; want status 401 without the key", err)
	}
	if got := fake.Emails(); len(got) != 1 || got[0].To[0] != msg.To || got[0].Subject != msg.Subject || got[0].UserAgent != "roster-mate" {
		t.Errorf("fake emails = %+v; want the one sent with the right key", got)
	}
}
