-- A babysitter is tentative until the user marks them confirmed (SIM-41). The status syncs with the
-- name under the same last-write-wins. Existing babysitters become tentative; their rev is left
-- alone, so no phone pulls them again.
ALTER TABLE babysitters ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 0;
