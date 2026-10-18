package extract

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/anthropics/anthropic-sdk-go/option"

	"github.com/simonpratt/roster-mate/apps/server/internal/extract/fakeanthropic"
)

const testKey = "sk-ant-secret"

// serveFake serves a shared fake that accepts testKey, with change applied to its answer.
func serveFake(t *testing.T, change func(*fakeanthropic.Fake)) (*httptest.Server, *fakeanthropic.Fake) {
	t.Helper()
	f := fakeanthropic.New(testKey)
	if change != nil {
		f.Set(change)
	}
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	return srv, f
}

// lastBody decodes the body of the fake's last request.
func lastBody(t *testing.T, f *fakeanthropic.Fake) map[string]any {
	t.Helper()
	reqs := f.Requests()
	if len(reqs) == 0 {
		t.Fatal("the fake got no request")
	}
	var got map[string]any
	if err := json.Unmarshal(reqs[len(reqs)-1].Body, &got); err != nil {
		t.Fatal(err)
	}
	return got
}

func newTestClaude(url string) *Claude {
	return newTestClaudeWithKey(url, testKey)
}

func newTestClaudeWithKey(url, key string) *Claude {
	c := NewClaude(key, "claude-sonnet-5-5", "Simon Pratt",
		slog.New(slog.NewTextHandler(io.Discard, nil)), option.WithBaseURL(url), option.WithMaxRetries(0))
	c.Now = func() time.Time { return time.Date(2026, 10, 15, 9, 0, 0, 0, time.Local) }
	return c
}

func TestClaudeExtract(t *testing.T) {
	answer := `{"personFound":true,"shifts":[{"date":"2026-11-03","code":"N","rawCode":"N","uncertain":false},{"date":"2026-11-31","code":"D","rawCode":"D","uncertain":false}],"warnings":[]}`
	srv, f := serveFake(t, func(f *fakeanthropic.Fake) { f.Text = answer })

	r, err := newTestClaude(srv.URL).Extract(context.Background(), []byte{0xff, 0xd8, 0xff}, "image/jpeg")
	if err != nil {
		t.Fatal(err)
	}
	if !r.PersonFound || len(r.Shifts) != 1 || *r.Shifts[0].Code != "N" || len(r.Warnings) != 1 {
		t.Errorf("result = %+v", r)
	}

	req := lastBody(t, f)
	if req["model"] != "claude-sonnet-5-5" {
		t.Errorf("model = %v", req["model"])
	}
	format := req["output_config"].(map[string]any)["format"].(map[string]any)
	if format["type"] != "json_schema" || format["schema"] == nil {
		t.Errorf("output_config.format = %v", format)
	}
	system, _ := json.Marshal(req["system"])
	if !strings.Contains(string(system), "Simon Pratt") || !strings.Contains(string(system), "2026-10-15") {
		t.Errorf("system = %s", system)
	}
	content, _ := json.Marshal(req["messages"])
	if !strings.Contains(string(content), `"media_type":"image/jpeg"`) || !strings.Contains(string(content), `"data":"/9j/"`) {
		t.Errorf("messages = %s", content)
	}
}

func TestClaudeExtractErrorsAreSafe(t *testing.T) {
	cases := []struct {
		name, want string
		key        string
		change     func(*fakeanthropic.Fake)
	}{
		{"api error", "returned 401", "sk-ant-wrong", nil},
		{"overloaded", "returned 529", testKey, func(f *fakeanthropic.Fake) { f.Down = true }},
		{"refusal", "declined", testKey, func(f *fakeanthropic.Fake) { f.StopReason, f.Text = "refusal", "" }},
		{"cut off", "cut off", testKey, func(f *fakeanthropic.Fake) { f.StopReason, f.Text = "max_tokens", `{"personFound":tr` }},
		{"not json", "not valid JSON", testKey, func(f *fakeanthropic.Fake) { f.Text = "Here are the shifts" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv, _ := serveFake(t, tc.change)
			_, err := newTestClaudeWithKey(srv.URL, tc.key).Extract(context.Background(), []byte("x"), "image/png")
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("err = %v, want it to mention %q", err, tc.want)
			}
			if strings.Contains(err.Error(), "sk-ant") {
				t.Errorf("error leaks the key: %v", err)
			}
		})
	}
}

func TestClaudeExtractTimeout(t *testing.T) {
	srv, _ := serveFake(t, func(f *fakeanthropic.Fake) { f.Slow = 5 * time.Second })
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_, err := newTestClaude(srv.URL).Extract(ctx, []byte("x"), "image/png")
	if err == nil || err.Error() != "timed out" {
		t.Errorf("err = %v, want timed out", err)
	}
}
