package main

import (
	"bytes"
	"context"
	"strings"
	"testing"
)

func TestRunWithoutAppPasswordExitsNonZero(t *testing.T) {
	env := map[string]string{
		"APP_USERNAME":      "simon",
		"ANTHROPIC_API_KEY": "sk-test",
		"ROSTER_NAME":       "Simon P",
		"DATA_DIR":          t.TempDir(),
	}
	var stderr bytes.Buffer
	code := run(context.Background(), func(k string) string { return env[k] }, &stderr)
	if code == 0 {
		t.Fatal("run without APP_PASSWORD returned 0")
	}
	if !strings.Contains(stderr.String(), "APP_PASSWORD") {
		t.Errorf("stderr %q does not name APP_PASSWORD", stderr.String())
	}
}

func TestRunStartsAndStops(t *testing.T) {
	env := map[string]string{
		"APP_USERNAME":      "simon",
		"APP_PASSWORD":      "secret",
		"ANTHROPIC_API_KEY": "sk-test",
		"ROSTER_NAME":       "Simon P",
		"DATA_DIR":          t.TempDir(),
		"PORT":              "0",
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var stderr bytes.Buffer
	if code := run(ctx, func(k string) string { return env[k] }, &stderr); code != 0 {
		t.Fatalf("run = %d, stderr %q", code, stderr.String())
	}
}
