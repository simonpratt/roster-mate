-- Key/value settings: 'schema_version' now; 'rev', 'db_id' and 'session_secret' in later migrations.
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
