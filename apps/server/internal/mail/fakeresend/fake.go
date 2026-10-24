// Package fakeresend is the one shared fake of the Resend API's POST /emails, used by the mail
// package's tests and the server's app tests (booted through run() with RESEND_BASE_URL).
package fakeresend

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
)

// Email is one email the fake accepted.
type Email struct {
	From      string   `json:"from"`
	To        []string `json:"to"`
	Subject   string   `json:"subject"`
	HTML      string   `json:"html"`
	Text      string   `json:"text"`
	UserAgent string   `json:"-"`
}

// Fake answers POST /emails like Resend: 200 {"id"} for the right bearer key, 401 for any other,
// and 500 for an email to an address set to fail.
type Fake struct {
	key string

	mu     sync.Mutex
	fail   map[string]bool
	emails []Email
}

// New returns a fake that accepts only the API key key.
func New(key string) *Fake { return &Fake{key: key, fail: map[string]bool{}} }

// Fail makes every email to these addresses answer 500.
func (f *Fake) Fail(addresses ...string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, a := range addresses {
		f.fail[strings.ToLower(a)] = true
	}
}

// Emails returns a copy of every email accepted so far, in order.
func (f *Fake) Emails() []Email {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]Email(nil), f.emails...)
}

func (f *Fake) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost || r.URL.Path != "/emails" {
		writeError(w, http.StatusNotFound, "not_found", "Not found")
		return
	}
	if r.Header.Get("Authorization") != "Bearer "+f.key {
		writeError(w, http.StatusUnauthorized, "validation_error", "API key is invalid")
		return
	}
	var e Email
	if err := json.NewDecoder(r.Body).Decode(&e); err != nil || len(e.To) == 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_error", "Invalid body")
		return
	}
	e.UserAgent = r.Header.Get("User-Agent")
	f.mu.Lock()
	for _, to := range e.To {
		if f.fail[strings.ToLower(to)] {
			f.mu.Unlock()
			writeError(w, http.StatusInternalServerError, "internal_server_error", "Fake failure")
			return
		}
	}
	f.emails = append(f.emails, e)
	n := len(f.emails)
	f.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"id":"fake-%d"}`, n)
}

func writeError(w http.ResponseWriter, status int, name, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]any{"statusCode": status, "name": name, "message": message})
}
