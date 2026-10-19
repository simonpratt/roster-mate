-- Shift history (SIM-45, ADR 0004): one row each time a sync applies a shift edit that changes the
-- date's code, keyed by the rev that write took. Nothing is backfilled: history starts here.
CREATE TABLE shift_changes (
  rev        INTEGER PRIMARY KEY,  -- the rev the shift write took; one change per write
  date       TEXT NOT NULL,
  from_code  TEXT,                 -- NULL: the date had no row, or the reserved null code
  to_code    TEXT,                 -- NULL only for the reserved tombstone
  source     TEXT,                 -- 'sheet' | 'import' | NULL (unknown: an older client)
  edited_at  INTEGER NOT NULL
);
