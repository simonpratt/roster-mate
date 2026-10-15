-- Key/value settings: 'schema_version', 'session_secret' (written on first start by the
-- server, not a migration); 'rev' and 'db_id' in later migrations.
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
