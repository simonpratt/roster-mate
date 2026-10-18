// Package fakeanthropic is the one shared fake of the Anthropic Messages API, used by the
// extraction client's tests, the server's app tests and (through cmd/fake-anthropic) the
// browser suite.
//
// The fixture, roster.json, is one extraction Result: personFound true, no warnings and 5
// shifts in December 2026, one per Date from 8 to 12 Dec, coded D, E, N, X and the Other
// code SE.
package fakeanthropic

import (
	"context"
	_ "embed"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Roster is the fixture: the Result JSON the fake answers with by default.
//
//go:embed roster.json
var Roster string

// Request is one request the fake received.
type Request struct {
	Method string
	Path   string
	// Images is the number of image blocks across the request's messages.
	Images int
	Body   []byte
}

// Fake answers POST /v1/messages like the Messages API with structured outputs. Its exported
// fields set the answer; once it is serving, change them only through Set.
type Fake struct {
	// Down answers every message with 529 overloaded_error.
	Down bool
	// Slow delays each answer, or until the client hangs up.
	Slow time.Duration
	// StopReason and Text are the answer's stop_reason and its one text block
	// (default "end_turn" and Roster).
	StopReason string
	Text       string

	key      string
	mu       sync.Mutex
	requests []Request
}

// New returns a fake that accepts only the API key key.
func New(key string) *Fake {
	return &Fake{key: key, StopReason: "end_turn", Text: Roster}
}

// Set changes the fake's answer under its lock, so a test can change it mid-test.
func (f *Fake) Set(change func(*Fake)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	change(f)
}

// Requests returns a copy of every request received so far, in order.
func (f *Fake) Requests() []Request {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]Request(nil), f.requests...)
}

func (f *Fake) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	f.mu.Lock()
	f.requests = append(f.requests, Request{Method: r.Method, Path: r.URL.Path, Images: countImages(body), Body: body})
	down, slow, stopReason, text := f.Down, f.Slow, f.StopReason, f.Text
	f.mu.Unlock()

	if r.Method != http.MethodPost || r.URL.Path != "/v1/messages" {
		writeError(w, http.StatusNotFound, "not_found_error", "Not found")
		return
	}
	if r.Header.Get("x-api-key") != f.key {
		writeError(w, http.StatusUnauthorized, "authentication_error", "invalid x-api-key")
		return
	}
	if slow > 0 && !wait(r.Context(), slow) {
		return
	}
	if down {
		writeError(w, 529, "overloaded_error", "Overloaded")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	io.WriteString(w, Message(stopReason, text))
}

// Message is a Messages API response body with stopReason and one text block holding text.
func Message(stopReason, text string) string {
	b, _ := json.Marshal(map[string]any{
		"id": "msg_fake", "type": "message", "role": "assistant", "model": "claude-sonnet-5-5",
		"stop_reason": stopReason, "stop_sequence": nil,
		"content": []map[string]any{{"type": "text", "text": text}},
		"usage":   map[string]any{"input_tokens": 1200, "output_tokens": 80},
	})
	return string(b)
}

// writeError answers in the API's error shape.
func writeError(w http.ResponseWriter, status int, typ, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]any{
		"type": "error", "error": map[string]string{"type": typ, "message": msg},
	})
}

// countImages counts the image blocks in a Messages request body.
func countImages(body []byte) int {
	var req struct {
		Messages []struct {
			Content json.RawMessage `json:"content"`
		} `json:"messages"`
	}
	if json.Unmarshal(body, &req) != nil {
		return 0
	}
	n := 0
	for _, m := range req.Messages {
		// content is either a string or a list of blocks.
		if !strings.HasPrefix(strings.TrimSpace(string(m.Content)), "[") {
			continue
		}
		var blocks []struct {
			Type string `json:"type"`
		}
		json.Unmarshal(m.Content, &blocks)
		for _, b := range blocks {
			if b.Type == "image" {
				n++
			}
		}
	}
	return n
}

// wait sleeps for d, returning false if ctx ends first.
func wait(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
		return true
	case <-ctx.Done():
		return false
	}
}
