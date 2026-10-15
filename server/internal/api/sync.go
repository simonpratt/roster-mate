package api

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"
	"unicode/utf8"

	"github.com/simonpratt/roster-mate/server/internal/store"
)

const (
	maxChanges  = 1000
	maxNoteLen  = 500
	maxSyncBody = 4 << 20 // 1000 changes with 500-character notes, JSON-escaped, fit comfortably
)

type syncRequest struct {
	Since   int64        `json:"since"`
	Changes []syncChange `json:"changes"`
}

type syncChange struct {
	Date     string  `json:"date"`
	Code     *string `json:"code"`
	Note     string  `json:"note"`
	EditedAt int64   `json:"editedAt"`
}

type syncShift struct {
	Date     string  `json:"date"`
	Code     *string `json:"code"`
	Note     string  `json:"note"`
	EditedAt int64   `json:"editedAt"`
	Rev      int64   `json:"rev"`
}

type syncResponse struct {
	Rev    int64       `json:"rev"`
	DBID   string      `json:"dbId"`
	Shifts []syncShift `json:"shifts"`
}

// sync applies the phone's pending edits and returns every shift changed since its last sync.
// A request with any invalid change applies none of them.
func sync(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req syncRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxSyncBody)).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad request"})
			return
		}
		changes, err := validateSync(req)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		rev, shifts, err := st.ApplyAndPull(r.Context(), req.Since, changes)
		if err == nil {
			var dbID string
			if dbID, err = st.DBID(r.Context()); err == nil {
				res := syncResponse{Rev: rev, DBID: dbID, Shifts: make([]syncShift, len(shifts))}
				for i, s := range shifts {
					res.Shifts[i] = syncShift(s)
				}
				writeJSON(w, http.StatusOK, res)
				return
			}
		}
		slog.Error("sync", "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
	}
}

func validateSync(req syncRequest) ([]store.Change, error) {
	if req.Since < 0 {
		return nil, fmt.Errorf("since must be 0 or more")
	}
	if len(req.Changes) > maxChanges {
		return nil, fmt.Errorf("at most %d changes per request", maxChanges)
	}
	changes := make([]store.Change, len(req.Changes))
	for i, c := range req.Changes {
		if d, err := time.Parse(time.DateOnly, c.Date); err != nil || d.Format(time.DateOnly) != c.Date {
			return nil, fmt.Errorf("changes[%d]: date must be YYYY-MM-DD", i)
		}
		if c.Code != nil && !store.ValidCode(*c.Code) {
			return nil, fmt.Errorf("changes[%d]: code must be 1-2 uppercase letters or null", i)
		}
		if utf8.RuneCountInString(c.Note) > maxNoteLen {
			return nil, fmt.Errorf("changes[%d]: note must be at most %d characters", i, maxNoteLen)
		}
		if c.EditedAt <= 0 {
			return nil, fmt.Errorf("changes[%d]: editedAt must be positive", i)
		}
		changes[i] = store.Change(c)
	}
	return changes, nil
}
