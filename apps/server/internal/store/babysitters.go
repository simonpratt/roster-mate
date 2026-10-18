package store

import (
	"context"
	"database/sql"
	"fmt"
)

// Babysitter is the babysitter named for one date. An empty Name means no babysitter.
type Babysitter struct {
	Date     string
	Name     string
	EditedAt int64
	Rev      int64
}

func applyBabysitters(ctx context.Context, tx *sql.Tx, rev *int64, babysitters []Babysitter) error {
	for _, b := range babysitters {
		if err := applyLWW(ctx, tx, rev, "babysitter "+b.Date,
			`SELECT edited_at FROM babysitters WHERE date = ?`, []any{b.Date}, b.EditedAt,
			`INSERT INTO babysitters (date, name, edited_at, rev) VALUES (?, ?, ?, ?)
			 ON CONFLICT (date) DO UPDATE SET name = excluded.name,
			   edited_at = excluded.edited_at, rev = excluded.rev`,
			b.Date, b.Name, b.EditedAt); err != nil {
			return err
		}
	}
	return nil
}

func babysittersAfter(ctx context.Context, tx *sql.Tx, rev int64) ([]Babysitter, error) {
	rows, err := tx.QueryContext(ctx,
		`SELECT date, name, edited_at, rev FROM babysitters WHERE rev > ? ORDER BY rev`, rev)
	if err != nil {
		return nil, fmt.Errorf("read babysitters: %w", err)
	}
	defer rows.Close()
	babysitters := []Babysitter{}
	for rows.Next() {
		var b Babysitter
		if err := rows.Scan(&b.Date, &b.Name, &b.EditedAt, &b.Rev); err != nil {
			return nil, fmt.Errorf("read babysitters: %w", err)
		}
		babysitters = append(babysitters, b)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read babysitters: %w", err)
	}
	return babysitters, nil
}
