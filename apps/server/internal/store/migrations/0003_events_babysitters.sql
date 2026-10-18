-- Events and babysitters sync as their own records, each with its own last-write-wins
-- (docs/adr/0003-events-and-babysitters-sync-separately.md). Their writes share meta.rev with
-- shifts. The shift note goes: events replace it and existing notes are dropped.
CREATE TABLE events (
  id         TEXT PRIMARY KEY,           -- client-generated UUID
  date       TEXT NOT NULL,              -- YYYY-MM-DD
  text       TEXT NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0, -- 1 = tombstone, kept so the deletion syncs
  created_at INTEGER NOT NULL,           -- unix ms; orders events within a date
  edited_at  INTEGER NOT NULL,           -- last-write-wins key
  rev        INTEGER NOT NULL
);
CREATE INDEX events_rev ON events(rev);

CREATE TABLE babysitters (
  date      TEXT PRIMARY KEY,
  name      TEXT NOT NULL,               -- '' = no babysitter
  edited_at INTEGER NOT NULL,
  rev       INTEGER NOT NULL
);
CREATE INDEX babysitters_rev ON babysitters(rev);

ALTER TABLE shifts DROP COLUMN note;
