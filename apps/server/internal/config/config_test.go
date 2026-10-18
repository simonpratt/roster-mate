package config

import (
	"strings"
	"testing"
)

func env(overrides map[string]string) func(string) string {
	base := map[string]string{
		"APP_USERNAME":      "simon",
		"APP_PASSWORD":      "secret",
		"ANTHROPIC_API_KEY": "sk-test",
		"ROSTER_NAME":       "Simon P",
	}
	for k, v := range overrides {
		base[k] = v
	}
	return func(k string) string { return base[k] }
}

func TestLoadDefaults(t *testing.T) {
	cfg, err := Load(env(nil))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Port != 8080 || cfg.DataDir != "/data" || cfg.AnthropicModel != DefaultModel {
		t.Errorf("defaults = port %d, dataDir %q, model %q", cfg.Port, cfg.DataDir, cfg.AnthropicModel)
	}
	if cfg.SessionSecret != "" || cfg.TZ != "" || cfg.AnthropicBaseURL != "" || cfg.TestMode {
		t.Errorf("optional values should be empty, got secret %q, TZ %q, base URL %q, test mode %v",
			cfg.SessionSecret, cfg.TZ, cfg.AnthropicBaseURL, cfg.TestMode)
	}
}

func TestLoadOverrides(t *testing.T) {
	cfg, err := Load(env(map[string]string{
		"ANTHROPIC_MODEL":    "claude-opus-5-5",
		"SESSION_SECRET":     "s3",
		"PORT":               "9000",
		"DATA_DIR":           "/tmp/rm",
		"TZ":                 "Australia/Sydney",
		"ANTHROPIC_BASE_URL": "http://127.0.0.1:18081",
		"APP_TEST_MODE":      "1",
	}))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.AnthropicModel != "claude-opus-5-5" || cfg.SessionSecret != "s3" || cfg.Port != 9000 ||
		cfg.DataDir != "/tmp/rm" || cfg.TZ != "Australia/Sydney" ||
		cfg.AnthropicBaseURL != "http://127.0.0.1:18081" || !cfg.TestMode {
		t.Errorf("overrides not applied: %+v", cfg)
	}
}

func TestLoadMissingRequired(t *testing.T) {
	for _, key := range []string{"APP_USERNAME", "APP_PASSWORD", "ANTHROPIC_API_KEY", "ROSTER_NAME"} {
		t.Run(key, func(t *testing.T) {
			_, err := Load(env(map[string]string{key: ""}))
			if err == nil || !strings.Contains(err.Error(), key) {
				t.Fatalf("Load without %s: err = %v, want one naming it", key, err)
			}
		})
	}
}

func TestLoadNamesEveryMissingVariable(t *testing.T) {
	_, err := Load(func(string) string { return "" })
	if err == nil {
		t.Fatal("Load with empty env: want error")
	}
	for _, key := range []string{"APP_USERNAME", "APP_PASSWORD", "ANTHROPIC_API_KEY", "ROSTER_NAME"} {
		if !strings.Contains(err.Error(), key) {
			t.Errorf("error %q does not name %s", err, key)
		}
	}
}

func TestLoadInvalidValues(t *testing.T) {
	for name, over := range map[string]map[string]string{
		"PORT not a number": {"PORT": "http"},
		"PORT out of range": {"PORT": "70000"},
		"TZ unknown":        {"TZ": "Mars/Olympus"},
		"base URL relative": {"ANTHROPIC_BASE_URL": "/v1"},
		"base URL no host":  {"ANTHROPIC_BASE_URL": "http://"},
		"base URL ftp":      {"ANTHROPIC_BASE_URL": "ftp://example.com"},
		"base URL bare":     {"ANTHROPIC_BASE_URL": "localhost:18081"},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := Load(env(over)); err == nil {
				t.Fatal("want error")
			}
		})
	}
}

// Only the value 1 turns test mode on.
func TestLoadTestModeOnlyForOne(t *testing.T) {
	for v, want := range map[string]bool{"1": true, "": false, "0": false, "true": false, "yes": false} {
		cfg, err := Load(env(map[string]string{"APP_TEST_MODE": v}))
		if err != nil || cfg.TestMode != want {
			t.Errorf("APP_TEST_MODE=%q: TestMode = %v, %v; want %v", v, cfg.TestMode, err, want)
		}
	}
}

func TestLoadAcceptsHTTPSBaseURL(t *testing.T) {
	cfg, err := Load(env(map[string]string{"ANTHROPIC_BASE_URL": "https://proxy.lan/anthropic"}))
	if err != nil || cfg.AnthropicBaseURL != "https://proxy.lan/anthropic" {
		t.Errorf("Load = %q, %v", cfg.AnthropicBaseURL, err)
	}
}
