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
	return fmt.Sprintf(`{"date":%q,"code":%q,"note":"","editedAt":%d}`, date, code, editedAt)
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
		{"date":"2026-11-03","code":"L","note":"swapped with Sam","editedAt":1760500000000},
		{"date":"2026-11-04","code":null,"note":"","editedAt":1760500001000}]}`
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
	if a.Date != "2026-11-03" || a.Rev != 1 || a.Code == nil || *a.Code != "L" || a.Note != "swapped with Sam" || a.EditedAt != 1760500000000 {
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
	many := make([]string, maxChanges+1)
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
		"long note":        fmt.Sprintf(`{"since":0,"changes":[{"date":"2026-11-01","code":"D","note":%q,"editedAt":1}]}`, strings.Repeat("a", maxNoteLen+1)),
	} {
		res, out := do(t, "POST", base+"/api/sync", body, c)
		if res.StatusCode != 400 {
			t.Errorf("%s: %d %q; want 400", name, res.StatusCode, out)
		}
	}
	// 500 characters of multibyte text is within the limit.
	body := fmt.Sprintf(`{"since":0,"changes":[{"date":"2026-11-01","code":"D","note":%q,"editedAt":1}]}`, strings.Repeat("é", maxNoteLen))
	if res, out := do(t, "POST", base+"/api/sync", body, c); res.StatusCode != 200 {
		t.Errorf("500-character note: %d %q; want 200", res.StatusCode, out)
	}
}
