package store

import (
	"context"
	"reflect"
	"testing"
)

func TestReplaceRecipientsKeepsOrder(t *testing.T) {
	s := openTemp(t)
	ctx := context.Background()
	if got, err := s.Recipients(ctx); err != nil || len(got) != 0 || got == nil {
		t.Fatalf("Recipients on a new database = %#v, %v; want an empty list", got, err)
	}
	first := []Recipient{{Email: "nan@example.com", Babysitter: "Nan"}, {Email: "sam@example.com"}}
	if err := s.ReplaceRecipients(ctx, first); err != nil {
		t.Fatal(err)
	}
	second := []Recipient{{Email: "zoe@example.com"}, {Email: "amy@example.com", Babysitter: "Amy"}, {Email: "nan@example.com", Babysitter: "Nan"}}
	if err := s.ReplaceRecipients(ctx, second); err != nil {
		t.Fatal(err)
	}
	got, err := s.Recipients(ctx)
	if err != nil || !reflect.DeepEqual(got, second) {
		t.Errorf("Recipients = %+v, %v; want %+v", got, err, second)
	}
}

// The UNIQUE constraint ignores case, and a rejected replace keeps the old list.
func TestReplaceRecipientsRejectsDuplicateIgnoringCase(t *testing.T) {
	s := openTemp(t)
	ctx := context.Background()
	old := []Recipient{{Email: "sam@example.com"}}
	if err := s.ReplaceRecipients(ctx, old); err != nil {
		t.Fatal(err)
	}
	if err := s.ReplaceRecipients(ctx, []Recipient{{Email: "nan@example.com"}, {Email: "NAN@example.com"}}); err == nil {
		t.Fatal("ReplaceRecipients with a case-only duplicate: want error")
	}
	if got, err := s.Recipients(ctx); err != nil || !reflect.DeepEqual(got, old) {
		t.Errorf("Recipients after the failed replace = %+v, %v; want %+v", got, err, old)
	}
}

func TestLastRosterEmail(t *testing.T) {
	s := openTemp(t)
	ctx := context.Background()
	if got, err := s.LastRosterEmail(ctx); err != nil || got != nil {
		t.Fatalf("LastRosterEmail with none = %+v, %v; want nil", got, err)
	}
	older := RosterEmailSend{SentAt: 1000, FirstDate: "2026-12-07", LastDate: "2026-12-13", Recipients: 2, OK: true}
	newer := RosterEmailSend{SentAt: 2000, FirstDate: "2026-12-14", LastDate: "2026-12-20", Recipients: 1, OK: false}
	for _, e := range []RosterEmailSend{newer, older} { // inserted out of order: newest is by sent_at
		if err := s.RecordRosterEmail(ctx, e); err != nil {
			t.Fatal(err)
		}
	}
	got, err := s.LastRosterEmail(ctx)
	if err != nil || got == nil || *got != newer {
		t.Errorf("LastRosterEmail = %+v, %v; want %+v", got, err, newer)
	}
}
