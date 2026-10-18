// Package config loads and validates the server's settings from the environment.
// Every variable here is listed in docs/design.md § Configuration and in .env.example.
package config

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// DefaultModel is the extraction model used when ANTHROPIC_MODEL is unset.
const DefaultModel = "claude-sonnet-5-5"

// Config holds every setting the server reads from the environment.
type Config struct {
	Username        string
	Password        string
	AnthropicAPIKey string
	AnthropicModel  string
	RosterName      string
	// SessionSecret is empty when unset; the server then generates one and keeps it in the DB.
	SessionSecret string
	Port          int
	DataDir       string
	// TZ is the raw TZ value, empty when unset. Go applies it to time.Local itself.
	TZ string
	// AnthropicBaseURL, when set, points extraction at another Messages API address (a fake
	// in tests). Empty means the SDK's default.
	AnthropicBaseURL string
	// TestMode (APP_TEST_MODE=1) mounts the test-only routes such as POST /api/test/reset.
	TestMode bool
}

// Load reads the configuration through getenv (os.Getenv in production).
// It returns an error naming every required variable that is missing and any value that is invalid.
func Load(getenv func(string) string) (Config, error) {
	get := func(key string) string { return strings.TrimSpace(getenv(key)) }

	cfg := Config{
		Username:         get("APP_USERNAME"),
		Password:         getenv("APP_PASSWORD"), // a password may legitimately start or end with spaces
		AnthropicAPIKey:  get("ANTHROPIC_API_KEY"),
		AnthropicModel:   get("ANTHROPIC_MODEL"),
		RosterName:       get("ROSTER_NAME"),
		SessionSecret:    get("SESSION_SECRET"),
		DataDir:          get("DATA_DIR"),
		TZ:               get("TZ"),
		AnthropicBaseURL: get("ANTHROPIC_BASE_URL"),
		TestMode:         get("APP_TEST_MODE") == "1",
	}

	var missing []string
	for _, req := range []struct {
		key, val string
	}{
		{"APP_USERNAME", cfg.Username},
		{"APP_PASSWORD", cfg.Password},
		{"ANTHROPIC_API_KEY", cfg.AnthropicAPIKey},
		{"ROSTER_NAME", cfg.RosterName},
	} {
		if req.val == "" {
			missing = append(missing, req.key)
		}
	}
	if len(missing) > 0 {
		return Config{}, fmt.Errorf("missing required environment variable(s): %s", strings.Join(missing, ", "))
	}

	if cfg.AnthropicModel == "" {
		cfg.AnthropicModel = DefaultModel
	}
	if cfg.DataDir == "" {
		cfg.DataDir = "/data"
	}

	cfg.Port = 8080
	if p := get("PORT"); p != "" {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 || n > 65535 {
			return Config{}, fmt.Errorf("PORT must be a number from 0 to 65535, got %q", p)
		}
		cfg.Port = n
	}

	if cfg.TZ != "" {
		if _, err := time.LoadLocation(cfg.TZ); err != nil {
			return Config{}, fmt.Errorf("TZ %q is not a known time zone: %v", cfg.TZ, err)
		}
	}

	if cfg.AnthropicBaseURL != "" {
		u, err := url.Parse(cfg.AnthropicBaseURL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return Config{}, fmt.Errorf("ANTHROPIC_BASE_URL must be an absolute http or https URL, got %q", cfg.AnthropicBaseURL)
		}
	}

	return cfg, nil
}
