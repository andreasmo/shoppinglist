-- Grundschema. Bunny: bunny db migrations apply --dir server/migrations
-- Lokal wendet server/migrate.ts dieselben Dateien an.

CREATE TABLE households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households (id),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE invites (
  code_hash TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households (id),
  created_by TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Jedes Feld eines synchronisierten Datensatzes ist eine eigene Zeile. Last-Write-Wins pro Feld
-- erledigt der Upsert anhand von (ts, mid). rev ist der Sync-Cursor und steigt bei jeder Änderung.
CREATE TABLE fields (
  household_id TEXT NOT NULL REFERENCES households (id),
  tbl TEXT NOT NULL,
  rid TEXT NOT NULL,
  field TEXT NOT NULL,
  value TEXT NOT NULL,
  ts INTEGER NOT NULL,
  mid TEXT NOT NULL,
  rev INTEGER NOT NULL,
  PRIMARY KEY (household_id, tbl, rid, field)
);

CREATE INDEX fields_by_rev ON fields (household_id, rev);
