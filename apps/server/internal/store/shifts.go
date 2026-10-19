package store

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
)

// Change is one shift edit from a phone's outbox. A nil Code is the reserved tombstone.
// Source is where the edit was made: SourceSheet, SourceImport, SourceRestore, or "" when an
// older client didn't say.
type Change struct {
	Date     string
	Code     *string
	EditedAt int64
	Source   string
}

// The sources a shift edit can carry. A restore is the re-send after a server reset: it is
// applied but never recorded as a shift change.
const (
	SourceSheet   = "sheet"
	SourceImport  = "import"
	SourceRestore = "restore"
)

// ShiftChange records that a sync changed a date's code (ADR 0004). From is nil when the date
// had no row (or the reserved null code), and Source is nil when the client didn't say.
type ShiftChange struct {
	Rev      int64
	Date     string
	From     *string
	To       *string
	Source   *string
	EditedAt int64
}

// Shift is a stored row as the sync call returns it.
type Shift struct {
	Date     string
	Code     *string
	EditedAt int64
	Rev      int64
}

// Push is one sync request's edits, already validated.
type Push struct {
	Shifts      []Change
	Events      []Event      // Rev is ignored
	Babysitters []Babysitter // Rev is ignored
}

// Pull is what a sync returns: the current rev and every row of each kind written after since.
type Pull struct {
	Rev         int64
	Shifts      []Shift
	Events      []Event
	Babysitters []Babysitter
	// ShiftChanges are the shift changes recorded after since, in rev order.
	ShiftChanges []ShiftChange
}

// ApplyAndPull applies the pushed edits and returns the current rev with every shift, event
// and babysitter written after since, all in one transaction. An edit is written only if its
// key (a shift's or babysitter's date, an event's id) has no row or its EditedAt is at least
// the row's (last-write-wins); each write takes rev = ++meta.rev, one counter shared by all
// three kinds. A shift write that changes the date's code also records a shift change under
// its rev, unless its source is restore. When since is ahead of meta.rev the database was wiped or restored, so every
// row is returned. Callers validate the edits first.
func (s *Store) ApplyAndPull(ctx context.Context, since int64, push Push) (pull Pull, err error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Pull{}, err
	}
	defer func() {
		if err != nil {
			tx.Rollback()
		}
	}()

	rev, err := readRev(ctx, tx)
	if err != nil {
		return Pull{}, err
	}
	start := rev
	for _, c := range push.Shifts {
		if err := applyShift(ctx, tx, &rev, c); err != nil {
			return Pull{}, err
		}
	}
	if err := applyEvents(ctx, tx, &rev, push.Events); err != nil {
		return Pull{}, err
	}
	if err := applyBabysitters(ctx, tx, &rev, push.Babysitters); err != nil {
		return Pull{}, err
	}
	if rev != start {
		if _, err := tx.ExecContext(ctx, `UPDATE meta SET value = ? WHERE key = 'rev'`, strconv.FormatInt(rev, 10)); err != nil {
			return Pull{}, fmt.Errorf("write rev: %w", err)
		}
	}

	from := since
	if since > rev {
		from = 0
	}
	pull = Pull{Rev: rev}
	if pull.Shifts, err = shiftsAfter(ctx, tx, from); err != nil {
		return Pull{}, err
	}
	if pull.Events, err = eventsAfter(ctx, tx, from); err != nil {
		return Pull{}, err
	}
	if pull.Babysitters, err = babysittersAfter(ctx, tx, from); err != nil {
		return Pull{}, err
	}
	if pull.ShiftChanges, err = shiftChangesAfter(ctx, tx, from); err != nil {
		return Pull{}, err
	}
	if err := tx.Commit(); err != nil {
		return Pull{}, fmt.Errorf("commit sync: %w", err)
	}
	return pull, nil
}

// applyShift writes one shift edit under last-write-wins, as applyLWW does, and records a
// shift change when the write changes the date's code and isn't a restore.
func applyShift(ctx context.Context, tx *sql.Tx, rev *int64, c Change) error {
	var stored int64
	var storedCode sql.NullString
	hadRow := true
	err := tx.QueryRowContext(ctx, `SELECT edited_at, code FROM shifts WHERE date = ?`, c.Date).
		Scan(&stored, &storedCode)
	switch {
	case err == sql.ErrNoRows:
		hadRow = false
	case err != nil:
		return fmt.Errorf("read shift %s: %w", c.Date, err)
	case c.EditedAt < stored:
		return nil // an older edit loses to the stored one
	}
	*rev++
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO shifts (date, code, edited_at, rev) VALUES (?, ?, ?, ?)
		 ON CONFLICT (date) DO UPDATE SET code = excluded.code,
		   edited_at = excluded.edited_at, rev = excluded.rev`,
		c.Date, c.Code, c.EditedAt, *rev); err != nil {
		return fmt.Errorf("write shift %s: %w", c.Date, err)
	}
	sameCode := storedCode.Valid == (c.Code != nil) && (c.Code == nil || storedCode.String == *c.Code)
	if c.Source == SourceRestore || (hadRow && sameCode) {
		return nil
	}
	var source any
	if c.Source != "" {
		source = c.Source
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO shift_changes (rev, date, from_code, to_code, source, edited_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		*rev, c.Date, storedCode, c.Code, source, c.EditedAt); err != nil {
		return fmt.Errorf("record shift change %s: %w", c.Date, err)
	}
	return nil
}

func shiftChangesAfter(ctx context.Context, tx *sql.Tx, rev int64) ([]ShiftChange, error) {
	rows, err := tx.QueryContext(ctx,
		`SELECT rev, date, from_code, to_code, source, edited_at FROM shift_changes
		 WHERE rev > ? ORDER BY rev`, rev)
	if err != nil {
		return nil, fmt.Errorf("read shift changes: %w", err)
	}
	defer rows.Close()
	changes := []ShiftChange{}
	for rows.Next() {
		var sc ShiftChange
		var from, to, source sql.NullString
		if err := rows.Scan(&sc.Rev, &sc.Date, &from, &to, &source, &sc.EditedAt); err != nil {
			return nil, fmt.Errorf("read shift changes: %w", err)
		}
		sc.From, sc.To, sc.Source = nullable(from), nullable(to), nullable(source)
		changes = append(changes, sc)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read shift changes: %w", err)
	}
	return changes, nil
}

func nullable(s sql.NullString) *string {
	if !s.Valid {
		return nil
	}
	return &s.String
}

// applyLWW writes one edit under last-write-wins: it reads the row's edited_at with
// selectSQL, skips the edit if editedAt is older, and otherwise runs upsertSQL with args
// followed by the next rev.
func applyLWW(ctx context.Context, tx *sql.Tx, rev *int64, what, selectSQL string, key []any,
	editedAt int64, upsertSQL string, args ...any) error {
	var stored int64
	err := tx.QueryRowContext(ctx, selectSQL, key...).Scan(&stored)
	switch {
	case err == sql.ErrNoRows:
	case err != nil:
		return fmt.Errorf("read %s: %w", what, err)
	case editedAt < stored:
		return nil // an older edit loses to the stored one
	}
	*rev++
	if _, err := tx.ExecContext(ctx, upsertSQL, append(args, *rev)...); err != nil {
		return fmt.Errorf("write %s: %w", what, err)
	}
	return nil
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
		`SELECT date, code, edited_at, rev FROM shifts WHERE rev > ? ORDER BY rev`, rev)
	if err != nil {
		return nil, fmt.Errorf("read shifts: %w", err)
	}
	defer rows.Close()
	shifts := []Shift{}
	for rows.Next() {
		var sh Shift
		var code sql.NullString
		if err := rows.Scan(&sh.Date, &code, &sh.EditedAt, &sh.Rev); err != nil {
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
