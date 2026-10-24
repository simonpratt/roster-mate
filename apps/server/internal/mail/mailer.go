package mail

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/simonpratt/roster-mate/apps/server/internal/store"
)

// DefaultDelay is how long a Mailer waits after the last import sync before sending, so an
// import that took several sync batches sends one email.
const DefaultDelay = 30 * time.Second

// Mailer sends the roster email once an import's shift changes have synced (ADR 0005). There is
// one per process, and only when email is on. Its methods are safe for concurrent use.
type Mailer struct {
	// Delay is the wait after the latest ImportSynced (DefaultDelay). Set it before first use.
	Delay time.Duration
	// Now is the clock for today and the send record (time.Now, in TZ).
	Now func() time.Time

	st     *store.Store
	sender Sender
	from   string
	log    *slog.Logger

	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup

	mu          sync.Mutex
	first, last string // the pending span; "" when nothing is pending
	timer       *time.Timer
	gen         int // bumped by each ImportSynced, so a superseded timer does nothing
	closed      bool
}

// NewMailer returns a mailer that reads recipients and shifts from st and sends from from.
func NewMailer(st *store.Store, sender Sender, from string, log *slog.Logger) *Mailer {
	ctx, cancel := context.WithCancel(context.Background())
	return &Mailer{Delay: DefaultDelay, Now: time.Now, st: st, sender: sender, from: from, log: log, ctx: ctx, cancel: cancel}
}

// ImportSynced widens the pending span to cover first..last (YYYY-MM-DD) and restarts the delay.
func (m *Mailer) ImportSynced(first, last string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return
	}
	if m.first == "" || first < m.first {
		m.first = first
	}
	if last > m.last {
		m.last = last
	}
	if m.timer != nil {
		m.timer.Stop()
	}
	m.gen++
	gen := m.gen
	m.timer = time.AfterFunc(m.Delay, func() { m.fire(gen) })
}

// Close stops a pending timer, dropping its email, cancels a send in progress and waits for it.
func (m *Mailer) Close() {
	m.mu.Lock()
	m.closed = true
	if m.timer != nil {
		m.timer.Stop()
	}
	if m.first != "" {
		m.log.Warn("roster email dropped at shutdown", "first", m.first, "last", m.last)
		m.first, m.last = "", ""
	}
	m.mu.Unlock()
	m.cancel()
	m.wg.Wait()
}

func (m *Mailer) fire(gen int) {
	m.mu.Lock()
	if m.closed || gen != m.gen || m.first == "" {
		m.mu.Unlock()
		return
	}
	first, last := m.first, m.last
	m.first, m.last, m.timer = "", "", nil
	m.wg.Add(1)
	m.mu.Unlock()
	defer m.wg.Done()
	m.send(first, last)
}

// send emails every recipient the whole weeks covering first..last and records the outcome.
func (m *Mailer) send(first, last string) {
	ctx := m.ctx
	first, last = weekStart(first), weekEnd(last)
	recipients, err := m.st.Recipients(ctx)
	if err != nil {
		m.log.Error("roster email", "first", first, "last", last, "err", err)
		return
	}
	if len(recipients) == 0 {
		return
	}
	shifts, err := m.st.ShiftsBetween(ctx, first, last)
	if err != nil {
		m.log.Error("roster email", "first", first, "last", last, "err", err)
		return
	}
	now := m.Now()
	e := BuildRosterEmail(first, last, shifts, now)
	html, text, err := Render(e)
	if err != nil {
		m.log.Error("roster email", "first", first, "last", last, "err", err)
		return
	}
	sent, failed := 0, 0
	for _, r := range recipients {
		err := m.sender.Send(ctx, Message{From: m.from, To: r.Email, Subject: e.Subject, HTML: html, Text: text})
		if err != nil {
			failed++
			m.log.Warn("roster email send failed", "err", err)
			continue
		}
		sent++
	}
	m.log.Info("roster email", "first", first, "last", last, "sent", sent, "failed", failed)
	// Record even when Close cancelled the sends, so the screen shows what went out.
	rec := store.RosterEmailSend{SentAt: now.UnixMilli(), FirstDate: first, LastDate: last, Recipients: sent, OK: failed == 0}
	if err := m.st.RecordRosterEmail(context.WithoutCancel(ctx), rec); err != nil {
		m.log.Error("roster email", "first", first, "last", last, "err", err)
	}
}

// weekStart is the Monday on or before date; weekEnd the Sunday on or after. Both work on the
// calendar date (parsed as UTC midnight, so no zone or DST can move it).
func weekStart(date string) string {
	d, err := time.Parse(dateLayout, date)
	if err != nil {
		return date
	}
	return d.AddDate(0, 0, -((int(d.Weekday()) + 6) % 7)).Format(dateLayout)
}

func weekEnd(date string) string {
	d, err := time.Parse(dateLayout, date)
	if err != nil {
		return date
	}
	return d.AddDate(0, 0, (7-int(d.Weekday()))%7).Format(dateLayout)
}
