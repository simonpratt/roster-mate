package mail

import (
	"bytes"
	"context"
	"log/slog"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/simonpratt/roster-mate/apps/server/internal/mail/fakeresend"
	"github.com/simonpratt/roster-mate/apps/server/internal/store"
)

const testDelay = 100 * time.Millisecond

type logBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (l *logBuffer) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.Write(p)
}

func (l *logBuffer) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.String()
}

type mailerEnv struct {
	m    *Mailer
	st   *store.Store
	fake *fakeresend.Fake
	log  *logBuffer
}

// newMailer wires a Mailer to a temp-dir store holding recipients and the fake Resend, with a
// short delay and a clock in 2026.
func newMailer(t *testing.T, recipients ...string) mailerEnv {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	var list []store.Recipient
	for _, r := range recipients {
		list = append(list, store.Recipient{Email: r})
	}
	if err := st.ReplaceRecipients(context.Background(), list); err != nil {
		t.Fatal(err)
	}
	fake := fakeresend.New("re_key")
	srv := httptest.NewServer(fake)
	t.Cleanup(srv.Close)
	logs := &logBuffer{}
	m := NewMailer(st, NewResend(srv.URL, "re_key"), "Roster <roster@example.com>", slog.New(slog.NewTextHandler(logs, nil)))
	m.Delay = testDelay
	m.Now = func() time.Time { return today }
	t.Cleanup(m.Close)
	return mailerEnv{m, st, fake, logs}
}

// waitFor polls until cond holds or a few seconds pass.
func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func lastSend(t *testing.T, st *store.Store) *store.RosterEmailSend {
	t.Helper()
	e, err := st.LastRosterEmail(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return e
}

// Two imports within the delay send one email per recipient, in list order, covering the whole
// weeks from the first import's Monday to the second's Sunday.
func TestMailerMergesImportsIntoOneEmailOfWholeWeeks(t *testing.T) {
	env := newMailer(t, "nan@example.com", "mum@example.com")
	ctx := context.Background()
	if _, err := env.st.ApplyAndPull(ctx, 0, store.Push{Shifts: []store.Change{
		{Date: "2026-10-28", Code: ptr("N"), EditedAt: 1, Source: store.SourceImport},
		{Date: "2026-11-09", Code: ptr("SE"), EditedAt: 1, Source: store.SourceImport},
	}}); err != nil {
		t.Fatal(err)
	}

	start := time.Now()
	env.m.ImportSynced("2026-10-28", "2026-10-30") // Wed–Fri
	time.Sleep(testDelay / 2)
	env.m.ImportSynced("2026-11-09", "2026-11-09") // Mon
	waitFor(t, "a send record", func() bool { return lastSend(t, env.st) != nil })
	if elapsed := time.Since(start); elapsed < testDelay*3/2 {
		t.Errorf("sent after %v; want the delay restarted by the second call", elapsed)
	}
	time.Sleep(2 * testDelay) // nothing more should arrive

	emails := env.fake.Emails()
	if len(emails) != 2 || emails[0].To[0] != "nan@example.com" || emails[1].To[0] != "mum@example.com" {
		t.Fatalf("emails = %+v; want one each to nan then mum", emails)
	}
	for _, e := range emails {
		if len(e.To) != 1 || e.Subject != "New roster: 26 Oct – 15 Nov" || e.From != "Roster <roster@example.com>" {
			t.Errorf("email to %v: subject %q from %q", e.To, e.Subject, e.From)
		}
		for _, want := range []string{"Mon 26 Oct", "Sun 15 Nov", "Week of Mon 9 Nov"} {
			if !strings.Contains(e.Text, want) {
				t.Errorf("text lacks %q:\n%s", want, e.Text)
			}
		}
		if !strings.Contains(e.Text, "Wed 28 Oct  N  Night") || strings.Contains(e.Text, "Sun 25 Oct") || strings.Contains(e.Text, "Mon 16 Nov") {
			t.Errorf("text has the wrong dates or codes:\n%s", e.Text)
		}
		if !strings.Contains(e.HTML, "<html") {
			t.Errorf("html part is not HTML")
		}
	}
	got := lastSend(t, env.st)
	if got.FirstDate != "2026-10-26" || got.LastDate != "2026-11-15" || got.Recipients != 2 || !got.OK || got.SentAt != today.UnixMilli() {
		t.Errorf("record = %+v", got)
	}
	logs := env.log.String()
	if !strings.Contains(logs, `msg="roster email" first=2026-10-26 last=2026-11-15 sent=2 failed=0`) {
		t.Errorf("log lacks the roster email line:\n%s", logs)
	}
	if strings.Contains(logs, "@example.com") || strings.Contains(logs, "re_key") {
		t.Errorf("log names an address or the key:\n%s", logs)
	}
}

// One failing recipient doesn't stop the next, and the record counts only the success.
func TestMailerRecordsAPartialFailure(t *testing.T) {
	env := newMailer(t, "bad@example.com", "mum@example.com")
	env.fake.Fail("bad@example.com")
	env.m.ImportSynced("2026-11-02", "2026-11-03")
	waitFor(t, "a send record", func() bool { return lastSend(t, env.st) != nil })
	if emails := env.fake.Emails(); len(emails) != 1 || emails[0].To[0] != "mum@example.com" {
		t.Errorf("emails = %+v; want only mum's", emails)
	}
	if got := lastSend(t, env.st); got.Recipients != 1 || got.OK {
		t.Errorf("record = %+v; want recipients 1, ok false", got)
	}
	if logs := env.log.String(); !strings.Contains(logs, "sent=1 failed=1") || !strings.Contains(logs, "status 500") || strings.Contains(logs, "@example.com") {
		t.Errorf("log:\n%s", logs)
	}
}

// With no recipients nothing is sent or recorded.
func TestMailerWithNoRecipientsDoesNothing(t *testing.T) {
	env := newMailer(t)
	env.m.ImportSynced("2026-11-02", "2026-11-03")
	time.Sleep(3 * testDelay)
	if emails := env.fake.Emails(); len(emails) != 0 {
		t.Errorf("emails = %+v; want none", emails)
	}
	if got := lastSend(t, env.st); got != nil {
		t.Errorf("record = %+v; want none", got)
	}
}

// Close drops a pending email and says so in the log.
func TestMailerCloseDropsAPendingEmail(t *testing.T) {
	env := newMailer(t, "nan@example.com")
	env.m.ImportSynced("2026-11-02", "2026-11-03")
	env.m.Close()
	env.m.ImportSynced("2026-11-04", "2026-11-04") // after Close: ignored
	time.Sleep(3 * testDelay)
	if emails := env.fake.Emails(); len(emails) != 0 {
		t.Errorf("emails = %+v; want none after Close", emails)
	}
	if !strings.Contains(env.log.String(), "roster email dropped at shutdown") {
		t.Errorf("log lacks the drop:\n%s", env.log.String())
	}
}

func TestWholeWeeks(t *testing.T) {
	for _, tc := range []struct{ date, monday, sunday string }{
		{"2026-10-28", "2026-10-26", "2026-11-01"}, // Wed
		{"2026-10-26", "2026-10-26", "2026-11-01"}, // Mon
		{"2026-11-01", "2026-10-26", "2026-11-01"}, // Sun
		{"2026-12-31", "2026-12-28", "2027-01-03"}, // across a year
		{"2026-10-04", "2026-09-28", "2026-10-04"}, // Sydney's DST start
	} {
		if got := weekStart(tc.date); got != tc.monday {
			t.Errorf("weekStart(%s) = %s; want %s", tc.date, got, tc.monday)
		}
		if got := weekEnd(tc.date); got != tc.sunday {
			t.Errorf("weekEnd(%s) = %s; want %s", tc.date, got, tc.sunday)
		}
	}
}

func ptr(s string) *string { return &s }
