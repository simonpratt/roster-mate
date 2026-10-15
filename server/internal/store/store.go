// Package store owns the SQLite database: opening it, migrating it and the shift
// queries.
package store

import (
	"crypto/rand"
	"database/sql"
	"embed"
	"encoding/hex"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	_ "modernc.org/sqlite" // pure-Go driver, registered as "sqlite"
)

// FileName is the database file inside DATA_DIR.
const FileName = "roster-mate.db"

//go:embed migrations/*.sql
var migrationFiles embed.FS

// Store wraps the open database.
type Store struct {
	DB *sql.DB
}

// Open opens (creating if needed) $dataDir/roster-mate.db in WAL mode and applies any
// migrations that have not run yet.
func Open(dataDir string) (*Store, error) {
	migrations, err := fs.Sub(migrationFiles, "migrations")
	if err != nil {
		return nil, err
	}
	return open(dataDir, migrations)
}

func open(dataDir string, migrations fs.FS) (*Store, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}
	path := filepath.Join(dataDir, FileName)
	dsn := "file:" + path +
		"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_txlock=immediate"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	// One user, one process: a single connection keeps writes serialised and avoids SQLITE_BUSY.
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	if _, err := migrate(db, migrations); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{DB: db}, nil
}

// Close closes the database.
func (s *Store) Close() error { return s.DB.Close() }

// SchemaVersion returns the number of the last applied migration (0 for a new database).
func (s *Store) SchemaVersion() (int, error) { return schemaVersion(s.DB) }

// SessionSecret returns meta.session_secret, the HMAC key for session cookies when
// SESSION_SECRET is unset. The first call generates 32 random bytes and stores them, so
// sessions survive a restart.
func (s *Store) SessionSecret() ([]byte, error) {
	fresh := make([]byte, 32)
	if _, err := rand.Read(fresh); err != nil {
		return nil, fmt.Errorf("generate session secret: %w", err)
	}
	if _, err := s.DB.Exec(
		`INSERT INTO meta (key, value) VALUES ('session_secret', ?) ON CONFLICT (key) DO NOTHING`,
		hex.EncodeToString(fresh)); err != nil {
		return nil, fmt.Errorf("store session secret: %w", err)
	}
	var v string
	if err := s.DB.QueryRow(`SELECT value FROM meta WHERE key = 'session_secret'`).Scan(&v); err != nil {
		return nil, fmt.Errorf("read session secret: %w", err)
	}
	key, err := hex.DecodeString(v)
	if err != nil || len(key) < 32 {
		return nil, fmt.Errorf("meta.session_secret is not a hex value of at least 32 bytes")
	}
	return key, nil
}

type migration struct {
	version int
	name    string
}

// migrate applies, in order, every migration newer than meta.schema_version. Each migration
// runs in its own transaction together with the schema_version bump. Files are named
// NNNN_description.sql; the first one creates meta. It returns how many migrations it applied.
func migrate(db *sql.DB, migrations fs.FS) (int, error) {
	entries, err := fs.ReadDir(migrations, ".")
	if err != nil {
		return 0, fmt.Errorf("read migrations: %w", err)
	}
	var list []migration
	seen := map[int]string{}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		prefix, _, ok := strings.Cut(e.Name(), "_")
		v, err := strconv.Atoi(prefix)
		if !ok || err != nil || v < 1 {
			return 0, fmt.Errorf("migration %q: name must start with a positive number and an underscore", e.Name())
		}
		if other, dup := seen[v]; dup {
			return 0, fmt.Errorf("migrations %q and %q share version %d", other, e.Name(), v)
		}
		seen[v] = e.Name()
		list = append(list, migration{v, e.Name()})
	}
	sort.Slice(list, func(i, j int) bool { return list[i].version < list[j].version })

	current, err := schemaVersion(db)
	if err != nil {
		return 0, err
	}
	applied := 0
	for _, m := range list {
		if m.version <= current {
			continue
		}
		body, err := fs.ReadFile(migrations, m.name)
		if err != nil {
			return applied, fmt.Errorf("read migration %s: %w", m.name, err)
		}
		tx, err := db.Begin()
		if err != nil {
			return applied, err
		}
		if _, err := tx.Exec(string(body)); err != nil {
			tx.Rollback()
			return applied, fmt.Errorf("apply migration %s: %w", m.name, err)
		}
		if _, err := tx.Exec(
			`INSERT INTO meta (key, value) VALUES ('schema_version', ?)
			 ON CONFLICT (key) DO UPDATE SET value = excluded.value`, strconv.Itoa(m.version)); err != nil {
			tx.Rollback()
			return applied, fmt.Errorf("record migration %s: %w", m.name, err)
		}
		if err := tx.Commit(); err != nil {
			return applied, fmt.Errorf("commit migration %s: %w", m.name, err)
		}
		applied++
	}
	return applied, nil
}

// schemaVersion reads meta.schema_version, treating a database without meta as version 0.
func schemaVersion(db *sql.DB) (int, error) {
	var n int
	if err := db.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'meta'`).Scan(&n); err != nil {
		return 0, fmt.Errorf("read schema version: %w", err)
	}
	if n == 0 {
		return 0, nil
	}
	var v string
	err := db.QueryRow(`SELECT value FROM meta WHERE key = 'schema_version'`).Scan(&v)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("read schema version: %w", err)
	}
	version, err := strconv.Atoi(v)
	if err != nil {
		return 0, fmt.Errorf("meta.schema_version %q is not a number", v)
	}
	return version, nil
}
