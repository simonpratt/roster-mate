// Package config loads and validates the server's settings from the environment.
// Every variable here is listed in docs/design.md § Configuration and in .env.example.
package config

import (
	"fmt"
	"net/mail"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// DefaultModel is the extraction model used when ANTHROPIC_MODEL is unset.
const DefaultModel = "claude-sonnet-5-5"

// DefaultResendBaseURL is the Resend API address used when RESEND_BASE_URL is unset.
const DefaultResendBaseURL = "https://api.resend.com"

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
	// ResendAPIKey turns roster emails on when set. Empty means email is off.
	ResendAPIKey string
	// EmailFrom is the roster email's From address, display name allowed. Set whenever
	// ResendAPIKey is; empty otherwise.
	EmailFrom string
	// ResendBaseURL is the Resend API address (a fake in tests).
	ResendBaseURL string
}

// EmailEnabled reports whether roster emails are on, which is whenever RESEND_API_KEY is set.
func (c Config) EmailEnabled() bool { return c.ResendAPIKey != "" }

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
		ResendAPIKey:     get("RESEND_API_KEY"),
		ResendBaseURL:    get("RESEND_BASE_URL"),
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

	if cfg.AnthropicBaseURL != "" && !absoluteHTTPURL(cfg.AnthropicBaseURL) {
		return Config{}, fmt.Errorf("ANTHROPIC_BASE_URL must be an absolute http or https URL, got %q", cfg.AnthropicBaseURL)
	}

	if cfg.ResendBaseURL == "" {
		cfg.ResendBaseURL = DefaultResendBaseURL
	} else if !absoluteHTTPURL(cfg.ResendBaseURL) {
		return Config{}, fmt.Errorf("RESEND_BASE_URL must be an absolute http or https URL, got %q", cfg.ResendBaseURL)
	}

	if cfg.EmailEnabled() {
		from := get("EMAIL_FROM")
		if from == "" {
			return Config{}, fmt.Errorf("EMAIL_FROM is required when RESEND_API_KEY is set")
		}
		if _, err := mail.ParseAddress(from); err != nil {
			return Config{}, fmt.Errorf("EMAIL_FROM must be an email address, got %q", from)
		}
		cfg.EmailFrom = from
	}

	return cfg, nil
}

func absoluteHTTPURL(s string) bool {
	u, err := url.Parse(s)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}
