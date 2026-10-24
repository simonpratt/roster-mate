package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/simonpratt/roster-mate/apps/server/internal/auth"
	"github.com/simonpratt/roster-mate/apps/server/internal/store"
)

// newRecipientsServer serves the API on st with email on or off, returning its URL and a
// signed-in cookie.
func newRecipientsServer(t *testing.T, st *store.Store, email bool) (string, *http.Cookie) {
	t.Helper()
	a := auth.New("simon", "secret", []byte("0123456789abcdef0123456789abcdef"))
	a.FailDelay = 0
	srv := httptest.NewServer(NewRouter(http.NotFoundHandler(), a, st, nil, Options{Email: email}))
	t.Cleanup(srv.Close)
	return srv.URL, loginCookie(t, srv.URL)
}

func TestRecipientsRoundTrip(t *testing.T) {
	st := newStore(t)
	base, c := newRecipientsServer(t, st, true)

	res, body := do(t, "GET", base+"/api/recipients", "", c)
	if res.StatusCode != 200 || strings.TrimSpace(body) != `{"recipients":[],"lastSend":null}` {
		t.Fatalf("GET on an empty list = %d %s", res.StatusCode, body)
	}

	put := `{"recipients":[{"email":"  Nan@Example.COM ","babysitter":"  Nan "},{"email":"sam@example.com","babysitter":""}]}`
	want := `{"recipients":[{"email":"nan@example.com","babysitter":"Nan"},{"email":"sam@example.com","babysitter":""}],"lastSend":null}`
	res, body = do(t, "PUT", base+"/api/recipients", put, c)
	if res.StatusCode != 200 || strings.TrimSpace(body) != want {
		t.Fatalf("PUT = %d %s; want 200 %s", res.StatusCode, body, want)
	}
	res, body = do(t, "GET", base+"/api/recipients", "", c)
	if res.StatusCode != 200 || strings.TrimSpace(body) != want {
		t.Errorf("GET after PUT = %d %s; want %s", res.StatusCode, body, want)
	}

	if err := st.RecordRosterEmail(context.Background(), store.RosterEmailSend{
		SentAt: 1765000000000, FirstDate: "2026-12-07", LastDate: "2026-12-13", Recipients: 1, OK: false}); err != nil {
		t.Fatal(err)
	}
	res, body = do(t, "GET", base+"/api/recipients", "", c)
	if res.StatusCode != 200 || !strings.Contains(body, `"lastSend":{"at":1765000000000,"ok":false,"recipients":1}`) {
		t.Errorf("GET after a send = %d %s", res.StatusCode, body)
	}

	res, body = do(t, "PUT", base+"/api/recipients", `{"recipients":[]}`, c)
	if res.StatusCode != 200 || !strings.HasPrefix(body, `{"recipients":[],`) {
		t.Errorf("PUT an empty list = %d %s", res.StatusCode, body)
	}
}

func TestRecipientsValidation(t *testing.T) {
	st := newStore(t)
	base, c := newRecipientsServer(t, st, true)
	kept := `{"recipients":[{"email":"keep@example.com","babysitter":""}]}`
	if res, body := do(t, "PUT", base+"/api/recipients", kept, c); res.StatusCode != 200 {
		t.Fatalf("seed PUT = %d %s", res.StatusCode, body)
	}

	one := func(email, babysitter string) string {
		b, _ := json.Marshal(map[string]any{"recipients": []map[string]string{
			{"email": "ok@example.com", "babysitter": ""},
			{"email": email, "babysitter": babysitter},
		}})
		return string(b)
	}
	var eleven []string
	for i := range 11 {
		eleven = append(eleven, fmt.Sprintf(`{"email":"r%d@example.com","babysitter":""}`, i))
	}
	long := strings.Repeat("a", 254-len("@example.com")+1) + "@example.com"

	for name, tc := range map[string]struct{ body, want string }{
		"eleven recipients":   {`{"recipients":[` + strings.Join(eleven, ",") + `]}`, "at most 10 recipients"},
		"not an address":      {one("nan", ""), "recipients[1]: email must be an address like nan@example.com"},
		"empty address":       {one("  ", ""), "recipients[1]: email must be an address like nan@example.com"},
		"display name":        {one("Nan <nan@example.com>", ""), "recipients[1]: email must be an address like nan@example.com"},
		"two addresses":       {one("nan@example.com, sam@example.com", ""), "recipients[1]: email must be an address like nan@example.com"},
		"over 254 characters": {one(long, ""), "recipients[1]: email must be an address like nan@example.com"},
		"duplicate by case":   {one(" OK@example.com", ""), "recipients[1]: email is already on the list"},
		"long babysitter":     {one("nan@example.com", strings.Repeat("é", 41)), "recipients[1]: babysitter must be at most 40 characters"},
		"bad JSON":            {`{"recipients":`, "bad request"},
		"body over 64 KiB":    {`{"recipients":[{"email":"a@example.com","babysitter":"` + strings.Repeat(" ", 64<<10) + `"}]}`, "bad request"},
	} {
		t.Run(name, func(t *testing.T) {
			res, body := do(t, "PUT", base+"/api/recipients", tc.body, c)
			var got map[string]string
			json.Unmarshal([]byte(body), &got)
			if res.StatusCode != 400 || got["error"] != tc.want {
				t.Errorf("PUT = %d %s; want 400 %q", res.StatusCode, body, tc.want)
			}
		})
	}

	// Limits are inclusive: 10 recipients, a 254-character address, a 40-rune babysitter.
	var ten []string
	for i := range 9 {
		ten = append(ten, fmt.Sprintf(`{"email":"r%d@example.com","babysitter":""}`, i))
	}
	ten = append(ten, fmt.Sprintf(`{"email":%q,"babysitter":%q}`, long[1:], strings.Repeat("é", 40)))
	if res, body := do(t, "PUT", base+"/api/recipients", `{"recipients":[`+strings.Join(ten, ",")+`]}`, c); res.StatusCode != 200 {
		t.Errorf("PUT at the limits = %d %s; want 200", res.StatusCode, body)
	}
	if got, _ := st.Recipients(context.Background()); len(got) != 10 {
		t.Errorf("stored %d recipients; want 10", len(got))
	}
}

// A rejected PUT leaves the stored list as it was.
func TestRecipientsRejectedPutChangesNothing(t *testing.T) {
	st := newStore(t)
	base, c := newRecipientsServer(t, st, true)
	do(t, "PUT", base+"/api/recipients", `{"recipients":[{"email":"keep@example.com","babysitter":""}]}`, c)
	if res, _ := do(t, "PUT", base+"/api/recipients", `{"recipients":[{"email":"new@example.com"},{"email":"bad"}]}`, c); res.StatusCode != 400 {
		t.Fatalf("bad PUT = %d; want 400", res.StatusCode)
	}
	got, err := st.Recipients(context.Background())
	if err != nil || len(got) != 1 || got[0].Email != "keep@example.com" {
		t.Errorf("Recipients after a rejected PUT = %+v, %v", got, err)
	}
}

func TestRecipientsAre404WhenEmailIsOff(t *testing.T) {
	base, c := newRecipientsServer(t, newStore(t), false)
	for _, method := range []string{"GET", "PUT"} {
		res, body := do(t, method, base+"/api/recipients", `{"recipients":[]}`, c)
		if res.StatusCode != 404 || strings.TrimSpace(body) != `{"error":"not found"}` {
			t.Errorf("%s /api/recipients with email off = %d %s; want the JSON 404", method, res.StatusCode, body)
		}
	}
}

func TestRecipientsNeedASession(t *testing.T) {
	base, _ := newRecipientsServer(t, newStore(t), true)
	for _, method := range []string{"GET", "PUT"} {
		if res, body := do(t, method, base+"/api/recipients", `{"recipients":[]}`, nil); res.StatusCode != 401 {
			t.Errorf("%s /api/recipients without a session = %d %s; want 401", method, res.StatusCode, body)
		}
	}
}

func TestSessionReportsEmail(t *testing.T) {
	for _, email := range []bool{true, false} {
		base, c := newRecipientsServer(t, newStore(t), email)
		res, body := do(t, "GET", base+"/api/session", "", c)
		want := fmt.Sprintf(`{"username":"simon","email":%v}`, email)
		if res.StatusCode != 200 || strings.TrimSpace(body) != want {
			t.Errorf("email %v: GET /api/session = %d %s; want %s", email, res.StatusCode, body, want)
		}
	}
}
