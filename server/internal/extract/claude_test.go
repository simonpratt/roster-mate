package extract

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/anthropics/anthropic-sdk-go/option"
)

// fakeAnthropic answers /v1/messages with status and body, recording the last request.
func fakeAnthropic(t *testing.T, status int, body string) (*httptest.Server, *map[string]any) {
	t.Helper()
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &got)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	return srv, &got
}

func newTestClaude(url string) *Claude {
	c := NewClaude("sk-ant-secret", "claude-sonnet-5-5", "Simon Pratt",
		slog.New(slog.NewTextHandler(io.Discard, nil)), option.WithBaseURL(url), option.WithMaxRetries(0))
	c.Now = func() time.Time { return time.Date(2026, 10, 15, 9, 0, 0, 0, time.Local) }
	return c
}

func message(stopReason, text string) string {
	b, _ := json.Marshal(map[string]any{
		"id": "msg_1", "type": "message", "role": "assistant", "model": "claude-sonnet-5-5",
		"stop_reason": stopReason,
		"content":     []map[string]any{{"type": "text", "text": text}},
		"usage":       map[string]any{"input_tokens": 1200, "output_tokens": 80},
	})
	return string(b)
}

func TestClaudeExtract(t *testing.T) {
	answer := `{"personFound":true,"shifts":[{"date":"2026-11-03","code":"N","rawCode":"N","uncertain":false},{"date":"2026-11-31","code":"D","rawCode":"D","uncertain":false}],"warnings":[]}`
	srv, req := fakeAnthropic(t, 200, message("end_turn", answer))

	r, err := newTestClaude(srv.URL).Extract(context.Background(), []byte{0xff, 0xd8, 0xff}, "image/jpeg")
	if err != nil {
		t.Fatal(err)
	}
	if !r.PersonFound || len(r.Shifts) != 1 || *r.Shifts[0].Code != "N" || len(r.Warnings) != 1 {
		t.Errorf("result = %+v", r)
	}

	if (*req)["model"] != "claude-sonnet-5-5" {
		t.Errorf("model = %v", (*req)["model"])
	}
	format := (*req)["output_config"].(map[string]any)["format"].(map[string]any)
	if format["type"] != "json_schema" || format["schema"] == nil {
		t.Errorf("output_config.format = %v", format)
	}
	system, _ := json.Marshal((*req)["system"])
	if !strings.Contains(string(system), "Simon Pratt") || !strings.Contains(string(system), "2026-10-15") {
		t.Errorf("system = %s", system)
	}
	content, _ := json.Marshal((*req)["messages"])
	if !strings.Contains(string(content), `"media_type":"image/jpeg"`) || !strings.Contains(string(content), `"data":"/9j/"`) {
		t.Errorf("messages = %s", content)
	}
}

func TestClaudeExtractErrorsAreSafe(t *testing.T) {
	cases := []struct {
		name, want string
		status     int
		body       string
	}{
		{"api error", "returned 401", 401, `{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key sk-ant-secret"}}`},
		{"refusal", "declined", 200, message("refusal", "")},
		{"cut off", "cut off", 200, message("max_tokens", `{"personFound":tr`)},
		{"not json", "not valid JSON", 200, message("end_turn", "Here are the shifts")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv, _ := fakeAnthropic(t, tc.status, tc.body)
			_, err := newTestClaude(srv.URL).Extract(context.Background(), []byte("x"), "image/png")
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
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.ReadAll(r.Body) // so the server notices the client hanging up
		select {
		case <-r.Context().Done():
		case <-time.After(5 * time.Second):
		}
	}))
	t.Cleanup(srv.Close)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_, err := newTestClaude(srv.URL).Extract(ctx, []byte("x"), "image/png")
	if err == nil || err.Error() != "timed out" {
		t.Errorf("err = %v, want timed out", err)
	}
}
