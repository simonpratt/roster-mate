package store

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
)

// Change is one edit from a phone's outbox. A nil Code is the reserved tombstone.
type Change struct {
	Date     string
	Code     *string
	Note     string
	EditedAt int64
}

// Shift is a stored row as the sync call returns it.
type Shift struct {
	Date     string
	Code     *string
	Note     string
	EditedAt int64
	Rev      int64
}

// ApplyAndPull applies changes and returns the current rev with every shift written after
// since, all in one transaction. A change is written only if its date has no row or its
// EditedAt is at least the row's (last-write-wins); each write takes rev = ++meta.rev. When
// since is ahead of meta.rev the database was wiped or restored, so every row is returned.
// Callers validate changes first.
func (s *Store) ApplyAndPull(ctx context.Context, since int64, changes []Change) (rev int64, shifts []Shift, err error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return 0, nil, err
	}
	defer func() {
		if err != nil {
			tx.Rollback()
		}
	}()

	rev, err = readRev(ctx, tx)
	if err != nil {
		return 0, nil, err
	}
	start := rev
	for _, c := range changes {
		var editedAt int64
		err := tx.QueryRowContext(ctx, `SELECT edited_at FROM shifts WHERE date = ?`, c.Date).Scan(&editedAt)
		switch {
		case err == sql.ErrNoRows:
		case err != nil:
			return 0, nil, fmt.Errorf("read shift %s: %w", c.Date, err)
		case c.EditedAt < editedAt:
			continue // an older edit loses to the stored one
		}
		rev++
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO shifts (date, code, note, edited_at, rev) VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT (date) DO UPDATE SET code = excluded.code, note = excluded.note,
			   edited_at = excluded.edited_at, rev = excluded.rev`,
			c.Date, c.Code, c.Note, c.EditedAt, rev); err != nil {
			return 0, nil, fmt.Errorf("write shift %s: %w", c.Date, err)
		}
	}
	if rev != start {
		if _, err := tx.ExecContext(ctx, `UPDATE meta SET value = ? WHERE key = 'rev'`, strconv.FormatInt(rev, 10)); err != nil {
			return 0, nil, fmt.Errorf("write rev: %w", err)
		}
	}

	from := since
	if since > rev {
		from = 0
	}
	shifts, err = shiftsAfter(ctx, tx, from)
	if err != nil {
		return 0, nil, err
	}
	if err := tx.Commit(); err != nil {
		return 0, nil, fmt.Errorf("commit sync: %w", err)
	}
	return rev, shifts, nil
}

// DBID returns meta.db_id, the random ID generated when the database was created.
func (s *Store) DBID(ctx context.Context) (string, error) {
	var id string
	if err := s.DB.QueryRowContext(ctx, `SELECT value FROM meta WHERE key = 'db_id'`).Scan(&id); err != nil {
		return "", fmt.Errorf("read db_id: %w", err)
	}
	return id, nil
}

func shiftsAfter(ctx context.Context, tx *sql.Tx, rev int64) ([]Shift, error) {
	rows, err := tx.QueryContext(ctx,
		`SELECT date, code, note, edited_at, rev FROM shifts WHERE rev > ? ORDER BY rev`, rev)
	if err != nil {
		return nil, fmt.Errorf("read shifts: %w", err)
	}
	defer rows.Close()
	shifts := []Shift{}
	for rows.Next() {
		var sh Shift
		var code sql.NullString
		if err := rows.Scan(&sh.Date, &code, &sh.Note, &sh.EditedAt, &sh.Rev); err != nil {
			return nil, fmt.Errorf("read shifts: %w", err)
		}
		if code.Valid {
			sh.Code = &code.String
		}
		shifts = append(shifts, sh)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read shifts: %w", err)
	}
	return shifts, nil
}

func readRev(ctx context.Context, tx *sql.Tx) (int64, error) {
	var v string
	if err := tx.QueryRowContext(ctx, `SELECT value FROM meta WHERE key = 'rev'`).Scan(&v); err != nil {
		return 0, fmt.Errorf("read rev: %w", err)
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("meta.rev %q is not a number", v)
	}
	return n, nil
}
