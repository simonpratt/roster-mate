package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/simonpratt/roster-mate/apps/server/internal/auth"
	"github.com/simonpratt/roster-mate/apps/server/internal/store"
)

// newStore opens a fresh database in a temp dir (never on the repo's host mount).
func newStore(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

// newSyncServer serves the API on st and returns its URL and a signed-in cookie.
func newSyncServer(t *testing.T, st *store.Store) (string, *http.Cookie) {
	t.Helper()
	a := auth.New("simon", "secret", []byte("0123456789abcdef0123456789abcdef"))
	a.FailDelay = 0
	srv := httptest.NewServer(NewRouter(http.NotFoundHandler(), a, st, nil))
	t.Cleanup(srv.Close)
	return srv.URL, loginCookie(t, srv.URL)
}

func decodeSync(t *testing.T, body string) syncResponse {
	t.Helper()
	var res syncResponse
	if err := json.Unmarshal([]byte(body), &res); err != nil {
		t.Fatalf("decode %q: %v", body, err)
	}
	return res
}

func change(date, code string, editedAt int64) string {
	return fmt.Sprintf(`{"date":%q,"code":%q,"editedAt":%d}`, date, code, editedAt)
}

func syncBody(since int64, changes ...string) string {
	return fmt.Sprintf(`{"since":%d,"changes":[%s]}`, since, strings.Join(changes, ","))
}

func TestSyncRejectsInvalidCodesAndWritesNothing(t *testing.T) {
	st := newStore(t)
	base, c := newSyncServer(t, st)
	for _, bad := range []string{"ABC", "se", "D1"} {
		// A valid change alongside the bad one must not be applied either.
		body := syncBody(0, change("2026-11-01", "D", 1), change("2026-11-02", bad, 1))
		res, out := do(t, "POST", base+"/api/sync", body, c)
		if res.StatusCode != 400 || !strings.Contains(out, `"error"`) {
			t.Errorf("code %q: %d %q; want 400 with an error", bad, res.StatusCode, out)
		}
	}
	res, out := do(t, "POST", base+"/api/sync", syncBody(0), c)
	if got := decodeSync(t, out); res.StatusCode != 200 || got.Rev != 0 || len(got.Shifts) != 0 {
		t.Errorf("after rejected syncs: %d %q; want rev 0 and no shifts", res.StatusCode, out)
	}
}

func TestSyncAcceptsOtherCode(t *testing.T) {
	base, c := newSyncServer(t, newStore(t))
	res, out := do(t, "POST", base+"/api/sync", syncBody(0, change("2026-11-02", "SE", 5)), c)
	got := decodeSync(t, out)
	if res.StatusCode != 200 || len(got.Shifts) != 1 || got.Shifts[0].Code == nil || *got.Shifts[0].Code != "SE" {
		t.Errorf("SE: %d %q; want 200 returning SE", res.StatusCode, out)
	}
}

func TestSyncRequiresSession(t *testing.T) {
	base, _ := newSyncServer(t, newStore(t))
	res, out := do(t, "POST", base+"/api/sync", syncBody(0, change("2026-11-02", "D", 5)), nil)
	if res.StatusCode != 401 {
		t.Errorf("no cookie: %d %q; want 401", res.StatusCode, out)
	}
}

func TestSyncTwoChangesGetConsecutiveRevs(t *testing.T) {
	st := newStore(t)
	base, c := newSyncServer(t, st)
	body := `{"since":0,"changes":[
		{"date":"2026-11-03","code":"L","editedAt":1760500000000},
		{"date":"2026-11-04","code":null,"editedAt":1760500001000}]}`
	res, out := do(t, "POST", base+"/api/sync", body, c)
	if res.StatusCode != 200 {
		t.Fatalf("sync: %d %q", res.StatusCode, out)
	}
	got := decodeSync(t, out)
	dbID, _ := st.DBID(t.Context())
	if got.Rev != 2 || got.DBID != dbID || len(got.Shifts) != 2 {
		t.Fatalf("response = %+v; want rev 2, dbId %q, 2 shifts", got, dbID)
	}
	a, b := got.Shifts[0], got.Shifts[1]
	if a.Date != "2026-11-03" || a.Rev != 1 || a.Code == nil || *a.Code != "L" || a.EditedAt != 1760500000000 {
		t.Errorf("first shift = %+v", a)
	}
	if b.Date != "2026-11-04" || b.Rev != 2 || b.Code != nil {
		t.Errorf("second shift = %+v", b)
	}
	if !strings.Contains(out, `"code":null`) {
		t.Errorf("null code not serialised as null: %s", out)
	}
}

func TestSyncValidation(t *testing.T) {
	base, c := newSyncServer(t, newStore(t))
	many := make([]string, maxItems+1)
	for i := range many {
		many[i] = change("2026-11-01", "D", 1)
	}
	for name, body := range map[string]string{
		"not json":         `{`,
		"negative since":   syncBody(-1),
		"too many changes": syncBody(0, many...),
		"bad date":         syncBody(0, change("2026-13-01", "D", 1)),
		"unpadded date":    syncBody(0, change("2026-1-01", "D", 1)),
		"date with time":   syncBody(0, change("2026-11-01T00:00:00Z", "D", 1)),
		"zero editedAt":    syncBody(0, change("2026-11-01", "D", 0)),
	} {
		res, out := do(t, "POST", base+"/api/sync", body, c)
		if res.StatusCode != 400 {
			t.Errorf("%s: %d %q; want 400", name, res.StatusCode, out)
		}
	}
}

const uuidA = "0b6f3e1c-2f4a-4c1d-9e8b-1a2b3c4d5e6f"

func event(id, date, text string, deleted bool, createdAt, editedAt int64) string {
	return fmt.Sprintf(`{"id":%q,"date":%q,"text":%q,"deleted":%t,"createdAt":%d,"editedAt":%d}`,
		id, date, text, deleted, createdAt, editedAt)
}

func babysitter(date, name string, editedAt int64) string {
	return fmt.Sprintf(`{"date":%q,"name":%q,"editedAt":%d}`, date, name, editedAt)
}

func fullBody(since int64, changes, events, babysitters []string) string {
	return fmt.Sprintf(`{"since":%d,"changes":[%s],"events":[%s],"babysitters":[%s]}`, since,
		strings.Join(changes, ","), strings.Join(events, ","), strings.Join(babysitters, ","))
}

// Each invalid event or babysitter rejects the whole request, valid shift included.
func TestSyncRejectsInvalidEventsAndBabysittersAndWritesNothing(t *testing.T) {
	base, c := newSyncServer(t, newStore(t))
	ok := []string{change("2026-11-01", "D", 1)}
	okEvent := event(uuidA, "2026-11-01", "Dentist", false, 1, 1)
	okSitter := babysitter("2026-11-01", "Nan", 1)
	var shifts, events, sitters []string
	for i := 0; i < 400; i++ {
		shifts = append(shifts, change("2026-11-01", "D", 1))
	}
	for i := 0; i < 400; i++ {
		events = append(events, okEvent)
	}
	for i := 0; i < 201; i++ {
		sitters = append(sitters, okSitter)
	}
	for name, body := range map[string]string{
		"non-UUID id":       fullBody(0, ok, []string{event("not-a-uuid", "2026-11-01", "x", false, 1, 1)}, nil),
		"uppercase UUID":    fullBody(0, ok, []string{event(strings.ToUpper(uuidA), "2026-11-01", "x", false, 1, 1)}, nil),
		"event bad date":    fullBody(0, ok, []string{event(uuidA, "2026-11-1", "x", false, 1, 1)}, nil),
		"long text":         fullBody(0, ok, []string{event(uuidA, "2026-11-01", strings.Repeat("a", maxEventText+1), false, 1, 1)}, nil),
		"zero createdAt":    fullBody(0, ok, []string{event(uuidA, "2026-11-01", "x", false, 0, 1)}, nil),
		"zero editedAt":     fullBody(0, ok, []string{event(uuidA, "2026-11-01", "x", false, 1, 0)}, nil),
		"negative editedAt": fullBody(0, ok, []string{event(uuidA, "2026-11-01", "x", false, 1, -5)}, nil),
		"long name":         fullBody(0, ok, nil, []string{babysitter("2026-11-01", strings.Repeat("a", maxBabysitter+1), 1)}),
		"sitter bad date":   fullBody(0, ok, nil, []string{babysitter("2026-02-30", "Nan", 1)}),
		"sitter editedAt":   fullBody(0, ok, nil, []string{babysitter("2026-11-01", "Nan", 0)}),
		"1001 items":        fullBody(0, shifts, events, sitters),
	} {
		res, out := do(t, "POST", base+"/api/sync", body, c)
		if res.StatusCode != 400 || !strings.Contains(out, `"error"`) {
			t.Errorf("%s: %d %q; want 400 with an error", name, res.StatusCode, out)
		}
	}
	res, out := do(t, "POST", base+"/api/sync", syncBody(0), c)
	if got := decodeSync(t, out); res.StatusCode != 200 || got.Rev != 0 || len(got.Shifts)+len(got.Events)+len(got.Babysitters) != 0 {
		t.Errorf("after rejected syncs: %d %q; want rev 0 and nothing stored", res.StatusCode, out)
	}

	// At the limits (multibyte text counts code points; 1000 items in total) the request applies.
	body := fullBody(0, shifts, events, sitters[:200])
	if res, out := do(t, "POST", base+"/api/sync", body, c); res.StatusCode != 200 {
		t.Errorf("1000 items: %d %q; want 200", res.StatusCode, out)
	}
	body = fullBody(0, nil,
		[]string{event(uuidA, "2026-11-01", strings.Repeat("é", maxEventText), false, 1, 2)},
		[]string{babysitter("2026-11-01", strings.Repeat("é", maxBabysitter), 2)})
	if res, out := do(t, "POST", base+"/api/sync", body, c); res.StatusCode != 200 {
		t.Errorf("text and name at the limit: %d %q; want 200", res.StatusCode, out)
	}
}

// An older cached client sends only since and changes, with a note: it still syncs, and the
// response carries empty event and babysitter arrays.
func TestSyncFromOlderClient(t *testing.T) {
	base, c := newSyncServer(t, newStore(t))
	body := `{"since":0,"changes":[{"date":"2026-11-03","code":"L","note":"swapped with Sam","editedAt":5}]}`
	res, out := do(t, "POST", base+"/api/sync", body, c)
	got := decodeSync(t, out)
	if res.StatusCode != 200 || got.Rev != 1 || len(got.Shifts) != 1 {
		t.Fatalf("older client: %d %q; want 200 with one shift", res.StatusCode, out)
	}
	if !strings.Contains(out, `"events":[]`) || !strings.Contains(out, `"babysitters":[]`) || strings.Contains(out, "note") {
		t.Errorf("response %s; want empty events and babysitters arrays and no note", out)
	}
}

// Events and babysitters round-trip, and a deleted event reaches a device that synced before.
func TestSyncEventsBabysittersAndTombstone(t *testing.T) {
	base, c := newSyncServer(t, newStore(t))
	body := fullBody(0, []string{change("2026-11-03", "D", 1)},
		[]string{event(uuidA, "2026-11-03", "Dentist 3pm", false, 10, 20)},
		[]string{babysitter("2026-11-03", "Nan", 30)})
	res, out := do(t, "POST", base+"/api/sync", body, c)
	got := decodeSync(t, out)
	if res.StatusCode != 200 || got.Rev != 3 || len(got.Events) != 1 || len(got.Babysitters) != 1 {
		t.Fatalf("first sync: %d %q", res.StatusCode, out)
	}
	if e := got.Events[0]; e != (syncEvent{uuidA, "2026-11-03", "Dentist 3pm", false, 10, 20, 2}) {
		t.Errorf("event = %+v", e)
	}
	if b := got.Babysitters[0]; b != (syncBabysitter{"2026-11-03", "Nan", 30, 3}) {
		t.Errorf("babysitter = %+v", b)
	}

	body = fullBody(3, nil, []string{event(uuidA, "2026-11-03", "", true, 10, 40)}, nil)
	if res, out := do(t, "POST", base+"/api/sync", body, c); res.StatusCode != 200 {
		t.Fatalf("delete: %d %q", res.StatusCode, out)
	}
	// Another device last synced at rev 3.
	_, out = do(t, "POST", base+"/api/sync", syncBody(3), c)
	got = decodeSync(t, out)
	if got.Rev != 4 || len(got.Events) != 1 || !got.Events[0].Deleted || got.Events[0].ID != uuidA || len(got.Shifts) != 0 || len(got.Babysitters) != 0 {
		t.Errorf("pull from rev 3 = %s; want only the tombstone", out)
	}
}
