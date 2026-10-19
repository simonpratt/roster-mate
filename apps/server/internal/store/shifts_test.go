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
	pull := syncPush(t, s, since, Push{Shifts: changes})
	return pull.Rev, pull.Shifts
}

func syncPush(t *testing.T, s *Store, since int64, push Push) Pull {
	t.Helper()
	pull, err := s.ApplyAndPull(context.Background(), since, push)
	if err != nil {
		t.Fatalf("ApplyAndPull(%d): %v", since, err)
	}
	return pull
}

func codeOf(sh Shift) string {
	if sh.Code == nil {
		return "<nil>"
	}
	return *sh.Code
}

func TestApplyToEmptyDBThenPullNothingNew(t *testing.T) {
	s := openTemp(t)
	rev, shifts := sync(t, s, 0, Change{Date: "2026-11-03", Code: code("L"), EditedAt: 1000})
	if rev != 1 || len(shifts) != 1 {
		t.Fatalf("first sync = rev %d, %d shifts; want rev 1, 1 shift", rev, len(shifts))
	}
	got := shifts[0]
	if got.Date != "2026-11-03" || codeOf(got) != "L" || got.EditedAt != 1000 || got.Rev != 1 {
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
	rev, shifts = sync(t, s, 1, Change{Date: "2026-11-03", Code: code("E"), EditedAt: 3000})
	if rev != 2 || len(shifts) != 1 || codeOf(shifts[0]) != "E" || shifts[0].EditedAt != 3000 || shifts[0].Rev != 2 {
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
	sync(t, s, 0, Change{Date: "2026-11-04", Code: code("D"), EditedAt: 1000})
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

func strOf(p *string) string {
	if p == nil {
		return "<nil>"
	}
	return *p
}

// A shift write that changes the code (or creates the date) records one shift change under the
// write's rev, with the codes before and after, the source and editedAt.
func TestShiftWriteThatChangesTheCodeRecordsAChange(t *testing.T) {
	s := openTemp(t)
	syncPush(t, s, 0, Push{Shifts: []Change{{Date: "2026-11-03", Code: code("L"), EditedAt: 1000, Source: SourceImport}}})
	pull := syncPush(t, s, 1, Push{Shifts: []Change{{Date: "2026-11-03", Code: code("N"), EditedAt: 2000, Source: SourceSheet}}})
	if pull.Rev != 2 || len(pull.ShiftChanges) != 1 {
		t.Fatalf("pull from 1 = rev %d, %+v; want rev 2 and one change", pull.Rev, pull.ShiftChanges)
	}
	if c := pull.ShiftChanges[0]; c.Rev != 2 || c.Date != "2026-11-03" || strOf(c.From) != "L" ||
		strOf(c.To) != "N" || strOf(c.Source) != "sheet" || c.EditedAt != 2000 {
		t.Errorf("change = %+v (from %s, to %s, source %s)", c, strOf(c.From), strOf(c.To), strOf(c.Source))
	}

	all := syncPush(t, s, 0, Push{})
	if len(all.ShiftChanges) != 2 {
		t.Fatalf("all changes = %+v; want 2", all.ShiftChanges)
	}
	if c := all.ShiftChanges[0]; c.Rev != 1 || c.From != nil || strOf(c.To) != "L" || strOf(c.Source) != "import" {
		t.Errorf("creating change = %+v; want rev 1 from nil to L by import", c)
	}

	// An older client sends no source: recorded with a nil source. A tombstone is a change to nil.
	pull = syncPush(t, s, 2, Push{Shifts: []Change{{Date: "2026-11-03", Code: nil, EditedAt: 3000}}})
	if len(pull.ShiftChanges) != 1 || pull.ShiftChanges[0].Source != nil || pull.ShiftChanges[0].To != nil ||
		strOf(pull.ShiftChanges[0].From) != "N" {
		t.Errorf("no-source tombstone = %+v; want N to nil with nil source", pull.ShiftChanges)
	}
	// And from the null code back to a code: from is nil.
	pull = syncPush(t, s, 3, Push{Shifts: []Change{{Date: "2026-11-03", Code: code("D"), EditedAt: 4000, Source: SourceSheet}}})
	if len(pull.ShiftChanges) != 1 || pull.ShiftChanges[0].From != nil || strOf(pull.ShiftChanges[0].To) != "D" {
		t.Errorf("null to D = %+v", pull.ShiftChanges)
	}
}

// Re-saving the same code, a write that loses last-write-wins and a restore record nothing.
func TestShiftWritesThatRecordNoChange(t *testing.T) {
	s := openTemp(t)
	syncPush(t, s, 0, Push{Shifts: []Change{{Date: "2026-11-03", Code: code("L"), EditedAt: 1000, Source: SourceSheet}}})

	same := syncPush(t, s, 1, Push{Shifts: []Change{{Date: "2026-11-03", Code: code("L"), EditedAt: 2000, Source: SourceImport}}})
	if same.Rev != 2 || len(same.Shifts) != 1 || len(same.ShiftChanges) != 0 {
		t.Errorf("same code = rev %d, %d shifts, %+v; want the write at rev 2 and no change", same.Rev, len(same.Shifts), same.ShiftChanges)
	}
	lost := syncPush(t, s, 2, Push{Shifts: []Change{{Date: "2026-11-03", Code: code("N"), EditedAt: 1500, Source: SourceSheet}}})
	if lost.Rev != 2 || len(lost.ShiftChanges) != 0 {
		t.Errorf("losing edit = rev %d, %+v; want rev 2 and no change", lost.Rev, lost.ShiftChanges)
	}
	restore := syncPush(t, s, 2, Push{Shifts: []Change{
		{Date: "2026-11-03", Code: code("E"), EditedAt: 3000, Source: SourceRestore},
		{Date: "2026-11-04", Code: code("D"), EditedAt: 3000, Source: SourceRestore},
	}})
	if restore.Rev != 4 || len(restore.Shifts) != 2 || len(restore.ShiftChanges) != 0 {
		t.Errorf("restore = rev %d, %d shifts, %+v; want both written and no change", restore.Rev, len(restore.Shifts), restore.ShiftChanges)
	}
	var n int
	if err := s.DB.QueryRow(`SELECT count(*) FROM shift_changes`).Scan(&n); err != nil || n != 1 {
		t.Errorf("shift_changes rows = %d, %v; want only the first save's", n, err)
	}
}
