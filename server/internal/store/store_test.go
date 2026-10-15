package store

import (
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
	if err != nil || v != 1 {
		t.Errorf("SchemaVersion = %d, %v; want 1", v, err)
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
