-- One shift per date. code NULL is a reserved tombstone (see docs/design.md § Sync protocol).
-- edited_at is the phone's edit time in unix ms (the last-write-wins key); rev is the server
-- revision of the last write applied to the row.
CREATE TABLE shifts (
  date       TEXT PRIMARY KEY,
  code       TEXT NULL,
  note       TEXT NOT NULL DEFAULT '',
  edited_at  INTEGER NOT NULL,
  rev        INTEGER NOT NULL
);
CREATE INDEX shifts_rev ON shifts(rev);

-- rev counts applied writes; db_id identifies this database so clients notice a wipe or restore.
INSERT INTO meta (key, value) VALUES ('rev', '0');
INSERT INTO meta (key, value) VALUES ('db_id', lower(hex(randomblob(16))));
