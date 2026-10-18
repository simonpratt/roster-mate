package store

import (
	"context"
	"database/sql"
	"fmt"
)

// Event is one event on a date, as pushed by a phone or returned by a sync. Deleted marks a
// tombstone, kept so the deletion reaches other devices.
type Event struct {
	ID        string
	Date      string
	Text      string
	Deleted   bool
	CreatedAt int64
	EditedAt  int64
	Rev       int64
}

func applyEvents(ctx context.Context, tx *sql.Tx, rev *int64, events []Event) error {
	for _, e := range events {
		if err := applyLWW(ctx, tx, rev, "event "+e.ID,
			`SELECT edited_at FROM events WHERE id = ?`, []any{e.ID}, e.EditedAt,
			`INSERT INTO events (id, date, text, deleted, created_at, edited_at, rev)
			 VALUES (?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT (id) DO UPDATE SET date = excluded.date, text = excluded.text,
			   deleted = excluded.deleted, created_at = excluded.created_at,
			   edited_at = excluded.edited_at, rev = excluded.rev`,
			e.ID, e.Date, e.Text, e.Deleted, e.CreatedAt, e.EditedAt); err != nil {
			return err
		}
	}
	return nil
}

func eventsAfter(ctx context.Context, tx *sql.Tx, rev int64) ([]Event, error) {
	rows, err := tx.QueryContext(ctx,
		`SELECT id, date, text, deleted, created_at, edited_at, rev FROM events WHERE rev > ? ORDER BY rev`, rev)
	if err != nil {
		return nil, fmt.Errorf("read events: %w", err)
	}
	defer rows.Close()
	events := []Event{}
	for rows.Next() {
		var e Event
		if err := rows.Scan(&e.ID, &e.Date, &e.Text, &e.Deleted, &e.CreatedAt, &e.EditedAt, &e.Rev); err != nil {
			return nil, fmt.Errorf("read events: %w", err)
		}
		events = append(events, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read events: %w", err)
	}
	return events, nil
}
