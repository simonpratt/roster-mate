package store

import (
	"fmt"
	"testing"
)

const (
	eventA = "0b6f3e1c-2f4a-4c1d-9e8b-1a2b3c4d5e6f"
	eventB = "7d9e8f10-1111-4222-8333-944455556666"
)

func TestEventsRoundTripWithLastWriteWinsPerID(t *testing.T) {
	s := openTemp(t)
	pull := syncPush(t, s, 0, Push{Events: []Event{
		{ID: eventA, Date: "2026-11-03", Text: "Dentist 3pm", CreatedAt: 100, EditedAt: 1000},
		{ID: eventB, Date: "2026-11-03", Text: "Parents' night", CreatedAt: 200, EditedAt: 1000},
	}})
	want := []Event{
		{ID: eventA, Date: "2026-11-03", Text: "Dentist 3pm", CreatedAt: 100, EditedAt: 1000, Rev: 1},
		{ID: eventB, Date: "2026-11-03", Text: "Parents' night", CreatedAt: 200, EditedAt: 1000, Rev: 2},
	}
	if pull.Rev != 2 || fmt.Sprint(pull.Events) != fmt.Sprint(want) {
		t.Fatalf("first sync = rev %d, %+v; want rev 2, %+v", pull.Rev, pull.Events, want)
	}

	// Older edit to A: ignored. Equal edit to B: applies.
	pull = syncPush(t, s, 2, Push{Events: []Event{
		{ID: eventA, Date: "2026-11-03", Text: "stale", CreatedAt: 100, EditedAt: 999},
		{ID: eventB, Date: "2026-11-04", Text: "Parents' night moved", CreatedAt: 200, EditedAt: 1000},
	}})
	if pull.Rev != 3 || len(pull.Events) != 1 || pull.Events[0].ID != eventB ||
		pull.Events[0].Text != "Parents' night moved" || pull.Events[0].Date != "2026-11-04" || pull.Events[0].Rev != 3 {
		t.Errorf("second sync = rev %d, %+v; want rev 3 with only B updated", pull.Rev, pull.Events)
	}
	all := syncPush(t, s, 0, Push{})
	if len(all.Events) != 2 || all.Events[0].ID != eventA || all.Events[0].Text != "Dentist 3pm" {
		t.Errorf("all events = %+v; want A unchanged", all.Events)
	}
}

func TestEventTombstoneIsStoredAndReturned(t *testing.T) {
	s := openTemp(t)
	syncPush(t, s, 0, Push{Events: []Event{{ID: eventA, Date: "2026-11-03", Text: "Dentist", CreatedAt: 100, EditedAt: 1000}}})
	syncPush(t, s, 1, Push{Events: []Event{{ID: eventA, Date: "2026-11-03", Text: "", Deleted: true, CreatedAt: 100, EditedAt: 2000}}})

	// Another device last synced at rev 1, before the deletion.
	pull := syncPush(t, s, 1, Push{})
	if pull.Rev != 2 || len(pull.Events) != 1 || !pull.Events[0].Deleted || pull.Events[0].ID != eventA || pull.Events[0].Rev != 2 {
		t.Errorf("pull from rev 1 = rev %d, %+v; want the tombstone at rev 2", pull.Rev, pull.Events)
	}
}

func TestBabysittersRoundTripWithLastWriteWinsPerDate(t *testing.T) {
	s := openTemp(t)
	pull := syncPush(t, s, 0, Push{Babysitters: []Babysitter{
		{Date: "2026-11-03", Name: "Nan", EditedAt: 1000},
		{Date: "2026-11-04", Name: "Sam", EditedAt: 1000},
	}})
	want := []Babysitter{{"2026-11-03", "Nan", 1000, 1}, {"2026-11-04", "Sam", 1000, 2}}
	if pull.Rev != 2 || fmt.Sprint(pull.Babysitters) != fmt.Sprint(want) {
		t.Fatalf("first sync = rev %d, %+v; want %+v", pull.Rev, pull.Babysitters, want)
	}

	// Older edit to the 3rd: ignored. Equal edit to the 4th clearing the name: applies.
	pull = syncPush(t, s, 2, Push{Babysitters: []Babysitter{
		{Date: "2026-11-03", Name: "stale", EditedAt: 999},
		{Date: "2026-11-04", Name: "", EditedAt: 1000},
	}})
	if pull.Rev != 3 || len(pull.Babysitters) != 1 || pull.Babysitters[0] != (Babysitter{"2026-11-04", "", 1000, 3}) {
		t.Errorf("second sync = rev %d, %+v; want only the 4th cleared at rev 3", pull.Rev, pull.Babysitters)
	}
}

// Shifts, events and babysitters share one rev counter, and since filters all three.
func TestOneSyncSharesRevAcrossKinds(t *testing.T) {
	s := openTemp(t)
	syncPush(t, s, 0, Push{
		Shifts:      []Change{{Date: "2026-11-01", Code: code("D"), EditedAt: 1}},
		Events:      []Event{{ID: eventA, Date: "2026-11-01", Text: "old", CreatedAt: 1, EditedAt: 1}},
		Babysitters: []Babysitter{{Date: "2026-11-01", Name: "Nan", EditedAt: 1}},
	})
	pull := syncPush(t, s, 3, Push{
		Shifts:      []Change{{Date: "2026-11-02", Code: code("N"), EditedAt: 2}, {Date: "2026-11-03", Code: code("E"), EditedAt: 2}},
		Events:      []Event{{ID: eventB, Date: "2026-11-02", Text: "Swimming", CreatedAt: 2, EditedAt: 2}},
		Babysitters: []Babysitter{{Date: "2026-11-02", Name: "Sam", EditedAt: 2}},
	})
	if pull.Rev != 7 {
		t.Fatalf("rev = %d; want 7", pull.Rev)
	}
	revs := map[int64]bool{}
	for _, sh := range pull.Shifts {
		revs[sh.Rev] = true
	}
	for _, e := range pull.Events {
		revs[e.Rev] = true
	}
	for _, b := range pull.Babysitters {
		revs[b.Rev] = true
	}
	if len(pull.Shifts) != 2 || len(pull.Events) != 1 || len(pull.Babysitters) != 1 ||
		pull.Events[0].ID != eventB || pull.Babysitters[0].Date != "2026-11-02" {
		t.Fatalf("since 3 = %+v; want exactly the 4 newer rows", pull)
	}
	for r := int64(4); r <= 7; r++ {
		if !revs[r] {
			t.Errorf("revs %v; want each of 4..7 exactly once", revs)
		}
	}

	all := syncPush(t, s, 0, Push{})
	if len(all.Shifts) != 3 || len(all.Events) != 2 || len(all.Babysitters) != 2 {
		t.Errorf("since 0 = %+v; want every row", all)
	}
	reset := syncPush(t, s, 99, Push{})
	if len(reset.Shifts) != 3 || len(reset.Events) != 2 || len(reset.Babysitters) != 2 {
		t.Errorf("since ahead of rev = %+v; want every row", reset)
	}
}
