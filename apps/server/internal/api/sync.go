package api

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"time"
	"unicode/utf8"

	"github.com/simonpratt/roster-mate/apps/server/internal/store"
)

const (
	maxItems      = 1000 // across changes, events and babysitters
	maxEventText  = 200
	maxBabysitter = 40
	maxSyncBody   = 4 << 20 // 1000 items of the longest text, JSON-escaped, fit comfortably
)

// uuidPattern is a canonical lowercase UUID, as crypto.randomUUID() makes.
var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

type syncRequest struct {
	Since       int64            `json:"since"`
	Changes     []syncChange     `json:"changes"`
	Events      []syncEvent      `json:"events"`
	Babysitters []syncBabysitter `json:"babysitters"`
}

// syncChange is one shift edit. An older cached client may still send a note; the decoder
// ignores it. It may also leave out source, which is then stored as unknown.
type syncChange struct {
	Date     string  `json:"date"`
	Code     *string `json:"code"`
	EditedAt int64   `json:"editedAt"`
	Source   *string `json:"source"`
}

// syncShiftChange is a recorded shift change in a response.
type syncShiftChange struct {
	Rev      int64   `json:"rev"`
	Date     string  `json:"date"`
	From     *string `json:"from"`
	To       *string `json:"to"`
	Source   *string `json:"source"`
	EditedAt int64   `json:"editedAt"`
}

type syncShift struct {
	Date     string  `json:"date"`
	Code     *string `json:"code"`
	EditedAt int64   `json:"editedAt"`
	Rev      int64   `json:"rev"`
}

// syncEvent is an event both in a request (rev ignored) and in a response.
type syncEvent struct {
	ID        string `json:"id"`
	Date      string `json:"date"`
	Text      string `json:"text"`
	Deleted   bool   `json:"deleted"`
	CreatedAt int64  `json:"createdAt"`
	EditedAt  int64  `json:"editedAt"`
	Rev       int64  `json:"rev"`
}

// syncBabysitter is a babysitter both in a request (rev ignored) and in a response. A request
// without confirmed (an older client) means tentative.
type syncBabysitter struct {
	Date      string `json:"date"`
	Name      string `json:"name"`
	Confirmed bool   `json:"confirmed"`
	EditedAt  int64  `json:"editedAt"`
	Rev       int64  `json:"rev"`
}

type syncResponse struct {
	Rev         int64            `json:"rev"`
	DBID        string           `json:"dbId"`
	Shifts      []syncShift      `json:"shifts"`
	Events      []syncEvent      `json:"events"`
	Babysitters []syncBabysitter `json:"babysitters"`
	// ShiftChanges is always present, [] when there are none.
	ShiftChanges []syncShiftChange `json:"shiftChanges"`
}

// sync applies the phone's pending edits and returns every shift, event and babysitter
// changed since its last sync, with the shift changes recorded since then. A request with any invalid item applies none of them.
func sync(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req syncRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxSyncBody)).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad request"})
			return
		}
		push, err := validateSync(req)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		pull, err := st.ApplyAndPull(r.Context(), req.Since, push)
		if err == nil {
			var dbID string
			if dbID, err = st.DBID(r.Context()); err == nil {
				writeJSON(w, http.StatusOK, toResponse(pull, dbID))
				return
			}
		}
		slog.Error("sync", "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
	}
}

func toResponse(pull store.Pull, dbID string) syncResponse {
	res := syncResponse{
		Rev:          pull.Rev,
		DBID:         dbID,
		Shifts:       make([]syncShift, len(pull.Shifts)),
		Events:       make([]syncEvent, len(pull.Events)),
		Babysitters:  make([]syncBabysitter, len(pull.Babysitters)),
		ShiftChanges: make([]syncShiftChange, len(pull.ShiftChanges)),
	}
	for i, sc := range pull.ShiftChanges {
		res.ShiftChanges[i] = syncShiftChange(sc)
	}
	for i, s := range pull.Shifts {
		res.Shifts[i] = syncShift(s)
	}
	for i, e := range pull.Events {
		res.Events[i] = syncEvent(e)
	}
	for i, b := range pull.Babysitters {
		res.Babysitters[i] = syncBabysitter(b)
	}
	return res
}

func validDate(s string) bool {
	d, err := time.Parse(time.DateOnly, s)
	return err == nil && d.Format(time.DateOnly) == s
}

func validateSync(req syncRequest) (store.Push, error) {
	if req.Since < 0 {
		return store.Push{}, fmt.Errorf("since must be 0 or more")
	}
	if len(req.Changes)+len(req.Events)+len(req.Babysitters) > maxItems {
		return store.Push{}, fmt.Errorf("at most %d changes, events and babysitters per request", maxItems)
	}
	push := store.Push{
		Shifts:      make([]store.Change, len(req.Changes)),
		Events:      make([]store.Event, len(req.Events)),
		Babysitters: make([]store.Babysitter, len(req.Babysitters)),
	}
	for i, c := range req.Changes {
		if !validDate(c.Date) {
			return store.Push{}, fmt.Errorf("changes[%d]: date must be YYYY-MM-DD", i)
		}
		if c.Code != nil && !store.ValidCode(*c.Code) {
			return store.Push{}, fmt.Errorf("changes[%d]: code must be 1-2 uppercase letters or null", i)
		}
		if c.EditedAt <= 0 {
			return store.Push{}, fmt.Errorf("changes[%d]: editedAt must be positive", i)
		}
		var source string
		if c.Source != nil {
			switch source = *c.Source; source {
			case store.SourceSheet, store.SourceImport, store.SourceRestore:
			default:
				return store.Push{}, fmt.Errorf("changes[%d]: source must be sheet, import or restore", i)
			}
		}
		push.Shifts[i] = store.Change{Date: c.Date, Code: c.Code, EditedAt: c.EditedAt, Source: source}
	}
	for i, e := range req.Events {
		if !uuidPattern.MatchString(e.ID) {
			return store.Push{}, fmt.Errorf("events[%d]: id must be a lowercase UUID", i)
		}
		if !validDate(e.Date) {
			return store.Push{}, fmt.Errorf("events[%d]: date must be YYYY-MM-DD", i)
		}
		if utf8.RuneCountInString(e.Text) > maxEventText {
			return store.Push{}, fmt.Errorf("events[%d]: text must be at most %d characters", i, maxEventText)
		}
		if e.CreatedAt <= 0 || e.EditedAt <= 0 {
			return store.Push{}, fmt.Errorf("events[%d]: createdAt and editedAt must be positive", i)
		}
		e.Rev = 0
		push.Events[i] = store.Event(e)
	}
	for i, b := range req.Babysitters {
		if !validDate(b.Date) {
			return store.Push{}, fmt.Errorf("babysitters[%d]: date must be YYYY-MM-DD", i)
		}
		if utf8.RuneCountInString(b.Name) > maxBabysitter {
			return store.Push{}, fmt.Errorf("babysitters[%d]: name must be at most %d characters", i, maxBabysitter)
		}
		if b.EditedAt <= 0 {
			return store.Push{}, fmt.Errorf("babysitters[%d]: editedAt must be positive", i)
		}
		b.Rev = 0
		push.Babysitters[i] = store.Babysitter(b)
	}
	return push, nil
}
