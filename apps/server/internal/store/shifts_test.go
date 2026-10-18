package store

import (
	"context"
	"testing"
)

func openTemp(t *testing.T) *Store {
	t.Helper()
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func code(c string) *string { return &c }

func sync(t *testing.T, s *Store, since int64, changes ...Change) (int64, []Shift) {
	t.Helper()
	rev, shifts, err := s.ApplyAndPull(context.Background(), since, changes)
	if err != nil {
		t.Fatalf("ApplyAndPull(%d): %v", since, err)
	}
	return rev, shifts
}

func codeOf(sh Shift) string {
	if sh.Code == nil {
		return "<nil>"
	}
	return *sh.Code
}

func TestApplyToEmptyDBThenPullNothingNew(t *testing.T) {
	s := openTemp(t)
	rev, shifts := sync(t, s, 0, Change{Date: "2026-11-03", Code: code("L"), Note: "swapped with Sam", EditedAt: 1000})
	if rev != 1 || len(shifts) != 1 {
		t.Fatalf("first sync = rev %d, %d shifts; want rev 1, 1 shift", rev, len(shifts))
	}
	got := shifts[0]
	if got.Date != "2026-11-03" || codeOf(got) != "L" || got.Note != "swapped with Sam" || got.EditedAt != 1000 || got.Rev != 1 {
		t.Errorf("shift = %+v (code %s)", got, codeOf(got))
	}

	rev, shifts = sync(t, s, 1)
	if rev != 1 || len(shifts) != 0 {
		t.Errorf("second sync = rev %d, %v; want rev 1, no shifts", rev, shifts)
	}
}

func TestLastWriteWinsOnEditedAt(t *testing.T) {
	s := openTemp(t)
	sync(t, s, 0, Change{Date: "2026-11-03", Code: code("D"), EditedAt: 2000})

	// Older edit: ignored, rev unchanged.
	rev, shifts := sync(t, s, 1, Change{Date: "2026-11-03", Code: code("N"), EditedAt: 1999})
	if rev != 1 || len(shifts) != 0 {
		t.Errorf("older edit: rev %d, %v; want rev 1, no shifts", rev, shifts)
	}

	// Newer edit: replaces it.
	rev, shifts = sync(t, s, 1, Change{Date: "2026-11-03", Code: code("E"), Note: "early", EditedAt: 3000})
	if rev != 2 || len(shifts) != 1 || codeOf(shifts[0]) != "E" || shifts[0].Note != "early" || shifts[0].EditedAt != 3000 || shifts[0].Rev != 2 {
		t.Errorf("newer edit: rev %d, %+v; want rev 2 with E", rev, shifts)
	}

	// An equal editedAt also wins (>=).
	rev, shifts = sync(t, s, 2, Change{Date: "2026-11-03", Code: code("X"), EditedAt: 3000})
	if rev != 3 || len(shifts) != 1 || codeOf(shifts[0]) != "X" {
		t.Errorf("equal editedAt: rev %d, %+v; want rev 3 with X", rev, shifts)
	}
}

func TestNullCodeIsStoredAndReturned(t *testing.T) {
	s := openTemp(t)
	sync(t, s, 0, Change{Date: "2026-11-04", Code: code("D"), Note: "x", EditedAt: 1000})
	sync(t, s, 1, Change{Date: "2026-11-04", Code: nil, EditedAt: 2000})

	rev, shifts := sync(t, s, 0)
	if rev != 2 || len(shifts) != 1 || shifts[0].Code != nil || shifts[0].Date != "2026-11-04" {
		t.Errorf("rev %d, %+v; want one shift with a nil code", rev, shifts)
	}
}

func TestSinceAheadOfRevReturnsEveryRow(t *testing.T) {
	s := openTemp(t)
	sync(t, s, 0,
		Change{Date: "2026-11-01", Code: code("D"), EditedAt: 1},
		Change{Date: "2026-11-02", Code: code("SE"), EditedAt: 1},
	)
	// A phone that synced with a database later wiped or restored to an older backup.
	rev, shifts := sync(t, s, 41)
	if rev != 2 || len(shifts) != 2 || shifts[0].Rev != 1 || shifts[1].Rev != 2 {
		t.Errorf("rev %d, %+v; want rev 2 and both rows in rev order", rev, shifts)
	}
}

func TestDBIDIsKeptOnReopenAndDiffersPerDB(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	first, err := s.DBID(ctx)
	if err != nil || len(first) != 32 {
		t.Fatalf("DBID = %q, %v; want 32 hex characters", first, err)
	}
	s.Close()

	s, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if again, err := s.DBID(ctx); err != nil || again != first {
		t.Errorf("DBID after reopen = %q, %v; want %q", again, err, first)
	}

	other, err := openTemp(t).DBID(ctx)
	if err != nil || other == "" || other == first {
		t.Errorf("fresh DB's DBID = %q, %v; want a different non-empty ID", other, err)
	}
}

func TestValidCode(t *testing.T) {
	for _, c := range []string{"D", "E", "L", "N", "X", "SE", "XD", "A"} {
		if !ValidCode(c) {
			t.Errorf("ValidCode(%q) = false", c)
		}
	}
	for _, c := range []string{"", "ABC", "se", "d", "D1", "1", " D", "É"} {
		if ValidCode(c) {
			t.Errorf("ValidCode(%q) = true", c)
		}
	}
	if !IsStandardCode("X") || IsStandardCode("SE") {
		t.Error("IsStandardCode: want X standard and SE not")
	}
}
