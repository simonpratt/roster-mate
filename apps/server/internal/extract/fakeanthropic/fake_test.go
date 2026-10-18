package fakeanthropic_test

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/simonpratt/roster-mate/apps/server/internal/extract"
	"github.com/simonpratt/roster-mate/apps/server/internal/extract/fakeanthropic"
)

const body = `{"model":"m","max_tokens":10,"messages":[{"role":"user","content":[
	{"type":"image","source":{"type":"base64","media_type":"image/jpeg","data":"/9j/"}},
	{"type":"text","text":"Read the shifts."}]}]}`

func post(t *testing.T, url, key string) (int, string) {
	t.Helper()
	req, _ := http.NewRequest("POST", url+"/v1/messages", strings.NewReader(body))
	req.Header.Set("x-api-key", key)
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(b)
}

func errorType(t *testing.T, b string) string {
	t.Helper()
	var e struct {
		Type  string `json:"type"`
		Error struct {
			Type string `json:"type"`
		} `json:"error"`
	}
	if err := json.Unmarshal([]byte(b), &e); err != nil || e.Type != "error" {
		t.Fatalf("body %q is not the API's error shape (%v)", b, err)
	}
	return e.Error.Type
}

func TestFakeAnswersTheFixtureAndRecords(t *testing.T) {
	f := fakeanthropic.New("sk-ant-test")
	srv := httptest.NewServer(f)
	defer srv.Close()

	status, b := post(t, srv.URL, "sk-ant-test")
	if status != 200 {
		t.Fatalf("status = %d %s", status, b)
	}
	var msg struct {
		StopReason string `json:"stop_reason"`
		Content    []struct{ Type, Text string }
	}
	if err := json.Unmarshal([]byte(b), &msg); err != nil || msg.StopReason != "end_turn" || len(msg.Content) != 1 {
		t.Fatalf("message = %+v, %v", msg, err)
	}
	var r extract.Result
	if err := json.Unmarshal([]byte(msg.Content[0].Text), &r); err != nil {
		t.Fatal(err)
	}
	r = extract.Validate(r)
	var got []string
	for _, s := range r.Shifts {
		got = append(got, s.Date+" "+*s.Code)
	}
	want := []string{"2026-12-08 D", "2026-12-09 E", "2026-12-10 N", "2026-12-11 X", "2026-12-12 SE"}
	if !r.PersonFound || len(r.Warnings) != 0 || fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("fixture = %+v, shifts %q; want %q", r, got, want)
	}

	reqs := f.Requests()
	if len(reqs) != 1 || reqs[0].Method != "POST" || reqs[0].Path != "/v1/messages" || reqs[0].Images != 1 {
		t.Errorf("requests = %+v; want one POST /v1/messages with one image", reqs)
	}
}

func TestFakeRejectsAWrongKey(t *testing.T) {
	srv := httptest.NewServer(fakeanthropic.New("sk-ant-test"))
	defer srv.Close()
	for _, key := range []string{"", "sk-ant-other"} {
		status, b := post(t, srv.URL, key)
		if status != 401 || errorType(t, b) != "authentication_error" {
			t.Errorf("key %q: %d %s; want 401 authentication_error", key, status, b)
		}
	}
}

func TestFakeDownAndSetMidTest(t *testing.T) {
	f := fakeanthropic.New("k")
	srv := httptest.NewServer(f)
	defer srv.Close()

	f.Set(func(f *fakeanthropic.Fake) { f.Down = true })
	status, b := post(t, srv.URL, "k")
	if status != 529 || errorType(t, b) != "overloaded_error" {
		t.Errorf("down: %d %s; want 529 overloaded_error", status, b)
	}

	f.Set(func(f *fakeanthropic.Fake) { f.Down, f.StopReason, f.Text = false, "max_tokens", `{"personFound":tr` })
	status, b = post(t, srv.URL, "k")
	if status != 200 || b != fakeanthropic.Message("max_tokens", `{"personFound":tr`) {
		t.Errorf("after Set: %d %s", status, b)
	}
	if n := len(f.Requests()); n != 2 {
		t.Errorf("recorded %d requests; want 2", n)
	}
}
