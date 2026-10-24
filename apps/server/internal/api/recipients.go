package api

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/mail"
	"strings"
	"unicode/utf8"

	"github.com/simonpratt/roster-mate/apps/server/internal/store"
)

const (
	maxRecipients     = 10
	maxEmailLength    = 254
	maxRecipientsBody = 64 << 10
)

type recipient struct {
	Email      string `json:"email"`
	Babysitter string `json:"babysitter"`
}

type recipientsRequest struct {
	Recipients []recipient `json:"recipients"`
}

type lastSend struct {
	At         int64 `json:"at"`
	OK         bool  `json:"ok"`
	Recipients int   `json:"recipients"`
}

type recipientsResponse struct {
	Recipients []recipient `json:"recipients"`
	LastSend   *lastSend   `json:"lastSend"`
}

// getRecipients answers GET /api/recipients with the roster email list and the latest send.
func getRecipients(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeRecipients(w, r, st)
	}
}

// putRecipients answers PUT /api/recipients: it replaces the whole list and answers like GET.
// An invalid list changes nothing.
func putRecipients(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req recipientsRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxRecipientsBody)).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad request"})
			return
		}
		list, err := validateRecipients(req.Recipients)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		if err := st.ReplaceRecipients(r.Context(), list); err != nil {
			slog.Error("replace recipients", "err", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
			return
		}
		writeRecipients(w, r, st)
	}
}

func writeRecipients(w http.ResponseWriter, r *http.Request, st *store.Store) {
	list, err := st.Recipients(r.Context())
	var last *store.RosterEmailSend
	if err == nil {
		last, err = st.LastRosterEmail(r.Context())
	}
	if err != nil {
		slog.Error("read recipients", "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	res := recipientsResponse{Recipients: make([]recipient, len(list))}
	for i, rc := range list {
		res.Recipients[i] = recipient{Email: rc.Email, Babysitter: rc.Babysitter}
	}
	if last != nil {
		res.LastSend = &lastSend{At: last.SentAt, OK: last.OK, Recipients: last.Recipients}
	}
	writeJSON(w, http.StatusOK, res)
}

// validateRecipients trims and lowercases each address and trims each babysitter, returning
// the first problem it finds.
func validateRecipients(in []recipient) ([]store.Recipient, error) {
	if len(in) > maxRecipients {
		return nil, fmt.Errorf("at most %d recipients", maxRecipients)
	}
	list := make([]store.Recipient, len(in))
	seen := make(map[string]bool, len(in))
	for i, rc := range in {
		email := strings.ToLower(strings.TrimSpace(rc.Email))
		if !plainAddress(email) {
			return nil, fmt.Errorf("recipients[%d]: email must be an address like nan@example.com", i)
		}
		if seen[email] {
			return nil, fmt.Errorf("recipients[%d]: email is already on the list", i)
		}
		seen[email] = true
		babysitter := strings.TrimSpace(rc.Babysitter)
		if utf8.RuneCountInString(babysitter) > maxBabysitter {
			return nil, fmt.Errorf("recipients[%d]: babysitter must be at most %d characters", i, maxBabysitter)
		}
		list[i] = store.Recipient{Email: email, Babysitter: babysitter}
	}
	return list, nil
}

// plainAddress reports whether e is a bare address of at most 254 characters: no display
// name, no angle brackets, nothing net/mail would rewrite.
func plainAddress(e string) bool {
	if e == "" || len(e) > maxEmailLength {
		return false
	}
	a, err := mail.ParseAddress(e)
	return err == nil && a.Name == "" && a.Address == e
}
