-- Der einmal vergebene Server-Zeitstempel bleibt auch nach verlorenen Antworten gültig.
-- Nicht zeitbasiert löschen: Geräte können ihre Outbox noch Monate später wiederholen.
CREATE TABLE mutation_timestamps (
  household_id TEXT NOT NULL REFERENCES households (id),
  mid TEXT NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (household_id, mid)
);

-- Bereits vorhandene Mutationen übernehmen, soweit ihr Stand noch gespeichert ist.
INSERT INTO mutation_timestamps (household_id, mid, ts)
SELECT household_id, mid, MIN(ts) FROM fields
WHERE tbl IN ('store', 'list', 'category', 'product', 'entry') AND mid <> 'seed'
GROUP BY household_id, mid;
