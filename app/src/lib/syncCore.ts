// Abgleich-Kern ohne DOM-Abhängigkeiten: genutzt von der App (store.ts) und vom
// Service Worker (Background Sync, wenn die App geschlossen ist).
import { recordKey, type FieldRow, type Json, type SessionInfo } from "@shared/model.ts";
import { selectSyncBatch } from "@shared/syncTransport.ts";
import { api } from "./api.ts";
import { ldb, type OutboxItem, type StoredRecord } from "./db.ts";

export const BATCH_SIZE = 200;
export const BACKGROUND_SYNC_TAG = "outbox";

export const toMutation = ({ mid, tbl, rid, fields, ts }: OutboxItem) => ({ mid, tbl, rid, fields, ts });

/** Wendet gepullte Felder auf bekannte Datensätze an und liefert nur die geänderten. */
export function mergeRows(rows: FieldRow[], lookup: (key: string) => StoredRecord | undefined): Map<string, StoredRecord> {
  const changed = new Map<string, StoredRecord>();
  for (const [tbl, rid, field, value] of rows) {
    const k = recordKey(tbl, rid);
    const rec = changed.get(k) ?? lookup(k) ?? { key: k, tbl, rid, data: {} };
    let parsed: Json;
    try {
      parsed = JSON.parse(value);
    } catch {
      continue;
    }
    changed.set(k, { ...rec, data: { ...rec.data, [field]: parsed } });
  }
  return changed;
}

/**
 * Lädt die Outbox direkt aus IndexedDB hoch und holt Änderungen ab (Service Worker).
 * Doppelt gesendete Mutationen sind harmlos – der Server ist idempotent.
 */
export async function flushFromDb(): Promise<void> {
  const meta = new Map((await ldb.meta.toArray()).map((m) => [m.k, m.v]));
  const session = meta.get("session") as SessionInfo | undefined;
  if (!session) return;
  let cursor = Number(meta.get("cursor") ?? 0);
  for (let round = 0; round < 20; round++) {
    const batch = selectSyncBatch(await ldb.outbox.orderBy("ts").limit(BATCH_SIZE).toArray());
    const res = await api.sync(session.token, { cursor, mutations: batch.map(toMutation) });
    const keys = [...new Set(res.rows.map(([tbl, rid]) => recordKey(tbl, rid)))];
    const existing = new Map<string, StoredRecord>();
    for (const r of await ldb.records.bulkGet(keys)) if (r) existing.set(r.key, r);
    const changed = mergeRows(res.rows, (k) => existing.get(k));
    await ldb.transaction("rw", ldb.records, ldb.outbox, ldb.meta, async () => {
      if (changed.size) await ldb.records.bulkPut([...changed.values()]);
      if (batch.length) await ldb.outbox.bulkDelete(batch.map((b) => b.mid));
      await ldb.meta.bulkPut([{ k: "cursor", v: res.cursor }, { k: "lastSyncAt", v: Date.now() }]);
    });
    cursor = res.cursor;
    if (!res.hasMore && (await ldb.outbox.count()) === 0) break;
  }
}
