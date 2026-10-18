package store

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"testing/fstest"
)

func TestOpenCreatesDBInWALModeWithMeta(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer s.Close()

	if _, err := os.Stat(filepath.Join(dir, FileName)); err != nil {
		t.Fatalf("db file: %v", err)
	}
	var mode string
	if err := s.DB.QueryRow(`PRAGMA journal_mode`).Scan(&mode); err != nil || mode != "wal" {
		t.Errorf("journal_mode = %q, %v; want wal", mode, err)
	}
	v, err := s.SchemaVersion()
	if err != nil || v != 3 {
		t.Errorf("SchemaVersion = %d, %v; want 3", v, err)
	}
}

// Migration 0003 drops the shift note and keeps every other column of every row.
func TestMigration3DropsNoteAndKeepsShifts(t *testing.T) {
	dir := t.TempDir()
	upTo2 := fstest.MapFS{}
	for _, name := range []string{"0001_meta.sql", "0002_shifts.sql"} {
		body, err := migrationFiles.ReadFile("migrations/" + name)
		if err != nil {
			t.Fatal(err)
		}
		upTo2[name] = &fstest.MapFile{Data: body}
	}
	s, err := open(dir, upTo2)
	if err != nil {
		t.Fatalf("open at version 2: %v", err)
	}
	if _, err := s.DB.Exec(`INSERT INTO shifts (date, code, note, edited_at, rev) VALUES
		('2026-11-03', 'L', 'swapped with Sam', 1000, 1),
		('2026-11-04', NULL, 'gone', 2000, 2),
		('2026-11-05', 'SE', '', 3000, 3)`); err != nil {
		t.Fatal(err)
	}
	s.Close()

	s, err = Open(dir)
	if err != nil {
		t.Fatalf("Open with 0003: %v", err)
	}
	defer s.Close()
	var hasNote int
	if err := s.DB.QueryRow(`SELECT count(*) FROM pragma_table_info('shifts') WHERE name = 'note'`).Scan(&hasNote); err != nil || hasNote != 0 {
		t.Errorf("shifts note columns = %d, %v; want 0", hasNote, err)
	}
	rows, err := s.DB.Query(`SELECT date, coalesce(code, '<nil>'), edited_at, rev FROM shifts ORDER BY date`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var got []string
	for rows.Next() {
		var date, code string
		var editedAt, rev int64
		if err := rows.Scan(&date, &code, &editedAt, &rev); err != nil {
			t.Fatal(err)
		}
		got = append(got, fmt.Sprintf("%s %s %d %d", date, code, editedAt, rev))
	}
	want := []string{"2026-11-03 L 1000 1", "2026-11-04 <nil> 2000 2", "2026-11-05 SE 3000 3"}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("shifts = %q; want %q", got, want)
	}
}

// Reopening the same DATA_DIR (as a container restart does) keeps the data and applies only
// the migrations that are new.
func TestReopenKeepsDataAndSkipsAppliedMigrations(t *testing.T) {
	dir := t.TempDir()
	migrations := fstest.MapFS{
		"0001_meta.sql": {Data: []byte(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`)},
		"0002_seed.sql": {Data: []byte(`CREATE TABLE things (id INTEGER); INSERT INTO things VALUES (1);`)},
		"notes.txt":     {Data: []byte(`ignored`)},
	}

	s, err := open(dir, migrations)
	if err != nil {
		t.Fatalf("first open: %v", err)
	}
	s.Close()

	// Second start: nothing to apply. Re-running either migration would fail (CREATE TABLE
	// without IF NOT EXISTS) or duplicate the seeded row.
	s, err = open(dir, migrations)
	if err != nil {
		t.Fatalf("second open: %v", err)
	}
	n, err := migrate(s.DB, migrations)
	if err != nil || n != 0 {
		t.Fatalf("migrate on migrated db = %d, %v; want 0 applied", n, err)
	}
	var rows int
	if err := s.DB.QueryRow(`SELECT count(*) FROM things`).Scan(&rows); err != nil || rows != 1 {
		t.Errorf("things rows = %d, %v; want 1", rows, err)
	}
	s.Close()

	// A later release adds a migration: only that one runs.
	migrations["0003_more.sql"] = &fstest.MapFile{Data: []byte(`INSERT INTO things VALUES (3);`)}
	s, err = open(dir, migrations)
	if err != nil {
		t.Fatalf("third open: %v", err)
	}
	defer s.Close()
	if err := s.DB.QueryRow(`SELECT count(*) FROM things`).Scan(&rows); err != nil || rows != 2 {
		t.Errorf("things rows = %d, %v; want 2", rows, err)
	}
	if v, err := s.SchemaVersion(); err != nil || v != 3 {
		t.Errorf("SchemaVersion = %d, %v; want 3", v, err)
	}
}

// The generated session secret is created once and read back unchanged after a reopen.
func TestSessionSecretIsGeneratedOnceAndKept(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	first, err := s.SessionSecret()
	if err != nil || len(first) != 32 {
		t.Fatalf("SessionSecret = %x, %v; want 32 bytes", first, err)
	}
	if again, err := s.SessionSecret(); err != nil || string(again) != string(first) {
		t.Fatalf("second SessionSecret = %x, %v; want %x", again, err, first)
	}
	s.Close()

	s, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if reopened, err := s.SessionSecret(); err != nil || string(reopened) != string(first) {
		t.Fatalf("SessionSecret after reopen = %x, %v; want %x", reopened, err, first)
	}
}

func TestMigrationsApplyInNumericOrder(t *testing.T) {
	migrations := fstest.MapFS{
		"0010_b.sql": {Data: []byte(`INSERT INTO log VALUES ('b');`)},
		"0002_a.sql": {Data: []byte(`CREATE TABLE log (v TEXT); INSERT INTO log VALUES ('a');`)},
		"0001_m.sql": {Data: []byte(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`)},
	}
	s, err := open(t.TempDir(), migrations)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer s.Close()
	var got string
	if err := s.DB.QueryRow(`SELECT group_concat(v, '') FROM (SELECT v FROM log ORDER BY rowid)`).Scan(&got); err != nil || got != "ab" {
		t.Errorf("order = %q, %v; want ab", got, err)
	}
}

func TestFailedMigrationIsRolledBack(t *testing.T) {
	dir := t.TempDir()
	migrations := fstest.MapFS{
		"0001_m.sql":   {Data: []byte(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`)},
		"0002_bad.sql": {Data: []byte(`CREATE TABLE half (id INTEGER); SELECT nope FROM missing;`)},
	}
	if _, err := open(dir, migrations); err == nil {
		t.Fatal("open with a broken migration: want error")
	}
	migrations["0002_bad.sql"] = &fstest.MapFile{Data: []byte(`CREATE TABLE half (id INTEGER);`)}
	s, err := open(dir, migrations)
	if err != nil {
		t.Fatalf("open after fixing the migration: %v", err)
	}
	defer s.Close()
	if v, _ := s.SchemaVersion(); v != 2 {
		t.Errorf("SchemaVersion = %d; want 2", v)
	}
}

func TestBadMigrationNames(t *testing.T) {
	for name, fsys := range map[string]fstest.MapFS{
		"no number": {"meta.sql": {Data: []byte(`SELECT 1;`)}},
		"duplicate": {"0001_a.sql": {Data: []byte(`SELECT 1;`)}, "0001_b.sql": {Data: []byte(`SELECT 1;`)}},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := open(t.TempDir(), fsys); err == nil {
				t.Fatal("want error")
			}
		})
	}
}

// Reset empties shifts, events and babysitters and keeps meta: the session secret, the
// database id and the rev counter.
func TestResetClearsRowsAndKeepsMeta(t *testing.T) {
	s := openTemp(t)
	ctx := context.Background()
	secret, err := s.SessionSecret()
	if err != nil {
		t.Fatal(err)
	}
	dbID, err := s.DBID(ctx)
	if err != nil {
		t.Fatal(err)
	}
	pull := syncPush(t, s, 0, Push{
		Shifts:      []Change{{Date: "2026-12-08", Code: code("D"), EditedAt: 1000}},
		Events:      []Event{{ID: eventA, Date: "2026-12-08", Text: "Dentist", CreatedAt: 100, EditedAt: 1000}},
		Babysitters: []Babysitter{{Date: "2026-12-08", Name: "Nan", EditedAt: 1000}},
	})
	if pull.Rev != 3 {
		t.Fatalf("rev before reset = %d; want 3", pull.Rev)
	}

	if err := s.Reset(ctx); err != nil {
		t.Fatalf("Reset: %v", err)
	}

	for _, table := range []string{"shifts", "events", "babysitters"} {
		var n int
		if err := s.DB.QueryRow("SELECT count(*) FROM " + table).Scan(&n); err != nil || n != 0 {
			t.Errorf("%s rows after reset = %d, %v; want 0", table, n, err)
		}
	}
	all := syncPush(t, s, 0, Push{})
	if all.Rev != 3 || len(all.Shifts)+len(all.Events)+len(all.Babysitters) != 0 {
		t.Errorf("pull after reset = %+v; want rev 3 and nothing else", all)
	}
	if got, err := s.SessionSecret(); err != nil || string(got) != string(secret) {
		t.Errorf("session secret changed by reset (%v)", err)
	}
	if got, err := s.DBID(ctx); err != nil || got != dbID {
		t.Errorf("DBID after reset = %q, %v; want %q", got, err, dbID)
	}
	next := syncPush(t, s, 3, Push{Shifts: []Change{{Date: "2026-12-09", Code: code("E"), EditedAt: 2000}}})
	if next.Rev != 4 {
		t.Errorf("rev of the first write after reset = %d; want 4", next.Rev)
	}
}
