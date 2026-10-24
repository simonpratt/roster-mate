-- Roster email recipients and the record of each roster email sent (ADR 0005). Server-only:
-- neither table syncs.
CREATE TABLE recipients (
  position   INTEGER PRIMARY KEY,           -- list order, 0-based
  email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  babysitter TEXT NOT NULL DEFAULT ''       -- '' = no babysitter
);
CREATE TABLE roster_email_sends (
  id         INTEGER PRIMARY KEY,
  sent_at    INTEGER NOT NULL,              -- unix ms
  first_date TEXT NOT NULL,                 -- 'YYYY-MM-DD', the email's Monday
  last_date  TEXT NOT NULL,                 -- its Sunday
  recipients INTEGER NOT NULL,              -- how many were sent to successfully
  ok         INTEGER NOT NULL               -- 1 = every recipient succeeded
);
