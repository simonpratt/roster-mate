package mail

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Message is one email to one address.
type Message struct {
	From, To, Subject, HTML, Text string
}

// Sender sends one message.
type Sender interface {
	Send(ctx context.Context, m Message) error
}

// Resend sends through the Resend API's POST /emails, with plain net/http.
type Resend struct {
	baseURL string
	key     string
	client  *http.Client
}

// NewResend returns a sender for the Resend API at baseURL (config.DefaultResendBaseURL, or a
// fake in tests) with API key key.
func NewResend(baseURL, key string) *Resend {
	return &Resend{
		baseURL: strings.TrimSuffix(baseURL, "/"),
		key:     key,
		client:  &http.Client{Timeout: 15 * time.Second},
	}
}

type resendEmail struct {
	From    string   `json:"from"`
	To      []string `json:"to"`
	Subject string   `json:"subject"`
	HTML    string   `json:"html"`
	Text    string   `json:"text"`
}

// Send posts m. A non-2xx answer is an error naming only the status code: never the key, the
// address or the answer's body.
func (r *Resend) Send(ctx context.Context, m Message) error {
	body, err := json.Marshal(resendEmail{From: m.From, To: []string{m.To}, Subject: m.Subject, HTML: m.HTML, Text: m.Text})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.baseURL+"/emails", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("resend: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+r.key)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "roster-mate")
	res, err := r.client.Do(req)
	if err != nil {
		return fmt.Errorf("resend: %w", err)
	}
	defer res.Body.Close()
	io.Copy(io.Discard, io.LimitReader(res.Body, 1<<16))
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return fmt.Errorf("resend: status %d", res.StatusCode)
	}
	return nil
}
