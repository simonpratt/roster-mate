package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// Recipient is one address on the roster email list. An empty Babysitter means the recipient
// is not linked to a babysitter.
type Recipient struct {
	Email      string
	Babysitter string
}

// RosterEmailSend records one roster email: when it went out, the week it covered, how many
// recipients it reached and whether every one succeeded.
type RosterEmailSend struct {
	SentAt     int64 // unix ms
	FirstDate  string
	LastDate   string
	Recipients int
	OK         bool
}

// Recipients returns the recipient list in its saved order.
func (s *Store) Recipients(ctx context.Context) ([]Recipient, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT email, babysitter FROM recipients ORDER BY position`)
	if err != nil {
		return nil, fmt.Errorf("read recipients: %w", err)
	}
	defer rows.Close()
	list := []Recipient{}
	for rows.Next() {
		var r Recipient
		if err := rows.Scan(&r.Email, &r.Babysitter); err != nil {
			return nil, fmt.Errorf("read recipients: %w", err)
		}
		list = append(list, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read recipients: %w", err)
	}
	return list, nil
}

// ReplaceRecipients replaces the whole list with list, in order, in one transaction. The
// caller validates the addresses; a duplicate (ignoring case) fails and leaves the old list.
func (s *Store) ReplaceRecipients(ctx context.Context, list []Recipient) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM recipients`); err != nil {
		return fmt.Errorf("replace recipients: %w", err)
	}
	for i, r := range list {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO recipients (position, email, babysitter) VALUES (?, ?, ?)`,
			i, r.Email, r.Babysitter); err != nil {
			return fmt.Errorf("replace recipients: %w", err)
		}
	}
	return tx.Commit()
}

// LastRosterEmail returns the newest recorded roster email, or nil when none has been sent.
func (s *Store) LastRosterEmail(ctx context.Context) (*RosterEmailSend, error) {
	var e RosterEmailSend
	err := s.DB.QueryRowContext(ctx,
		`SELECT sent_at, first_date, last_date, recipients, ok FROM roster_email_sends
		 ORDER BY sent_at DESC, id DESC LIMIT 1`).
		Scan(&e.SentAt, &e.FirstDate, &e.LastDate, &e.Recipients, &e.OK)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read last roster email: %w", err)
	}
	return &e, nil
}

// RecordRosterEmail stores one roster email send.
func (s *Store) RecordRosterEmail(ctx context.Context, e RosterEmailSend) error {
	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO roster_email_sends (sent_at, first_date, last_date, recipients, ok) VALUES (?, ?, ?, ?, ?)`,
		e.SentAt, e.FirstDate, e.LastDate, e.Recipients, e.OK); err != nil {
		return fmt.Errorf("record roster email: %w", err)
	}
	return nil
}
