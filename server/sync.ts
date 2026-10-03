// Sync: Push und Pull in einem atomaren Batch.
import {
  CLIENT_TABLES,
  FIELD_NAME_RE,
  type FieldRow,
  type Json,
  MAX_FIELD_JSON,
  MAX_FIELDS_PER_MUTATION,
  type Mutation,
  type SyncRequest,
  type SyncResponse,
  type Tbl,
} from "../shared/model.ts";
import type { Db, Stmt } from "./db/types.ts";
import { HttpError } from "./http.ts";

export const MAX_MUTATIONS = 200;
export const PULL_LIMIT = 1000;
/** Uhren von Handys gehen manchmal vor – weiter als das darf ein Zeitstempel nicht in der Zukunft liegen. */
const MAX_CLOCK_SKEW_MS = 60_000;

/** Ein Feld schreiben, falls (ts, mid) neuer ist als der gespeicherte Stand. Vergibt eine neue rev. */
export function upsertField(householdId: string, tbl: Tbl, rid: string, field: string, value: Json, ts: number, mid: string): Stmt[] {
  return [
    { sql: "UPDATE households SET rev = rev + 1 WHERE id = ?", args: [householdId] },
    {
      sql: `INSERT INTO fields (household_id, tbl, rid, field, value, ts, mid, rev)
            VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT rev FROM households WHERE id = ?))
            ON CONFLICT (household_id, tbl, rid, field) DO UPDATE
              SET value = excluded.value, ts = excluded.ts, mid = excluded.mid, rev = excluded.rev
              WHERE excluded.ts > fields.ts OR (excluded.ts = fields.ts AND excluded.mid > fields.mid)`,
      args: [householdId, tbl, rid, field, JSON.stringify(value), ts, mid, householdId],
    },
  ];
}

export function pullStmt(householdId: string, cursor: number, limit = PULL_LIMIT): Stmt {
  return {
    sql: "SELECT tbl, rid, field, value, rev FROM fields WHERE household_id = ? AND rev > ? ORDER BY rev LIMIT ?",
    args: [householdId, cursor, limit],
  };
}

export async function sync(db: Db, householdId: string, req: SyncRequest): Promise<SyncResponse> {
  const now = Date.now();
  const stmts: Stmt[] = [];
  for (const m of req.mutations) {
    const ts = Math.min(m.ts, now + MAX_CLOCK_SKEW_MS);
    for (const [field, value] of Object.entries(m.fields)) stmts.push(...upsertField(householdId, m.tbl, m.rid, field, value, ts, m.mid));
  }
  stmts.push(pullStmt(householdId, req.cursor));
  const results = await db.batch(stmts);
  const pulled = results[results.length - 1];
  const rows: FieldRow[] = pulled.map((r) => [r.tbl as Tbl, String(r.rid), String(r.field), String(r.value), Number(r.rev)]);
  return {
    rows,
    cursor: rows.length ? rows[rows.length - 1][4] : req.cursor,
    hasMore: rows.length >= PULL_LIMIT,
  };
}

/** Prüft eine Sync-Anfrage streng – sie kommt von außen. */
export function parseSyncRequest(body: unknown): SyncRequest {
  const bad = (why: string): never => {
    throw new HttpError(400, `Ungültige Sync-Anfrage: ${why}`);
  };
  if (!body || typeof body !== "object") bad("kein Objekt");
  const { cursor, mutations } = body as Record<string, unknown>;
  if (typeof cursor !== "number" || !Number.isInteger(cursor) || cursor < 0) bad("cursor");
  if (!Array.isArray(mutations) || mutations.length > MAX_MUTATIONS) bad("mutations");
  const out: Mutation[] = [];
  for (const raw of mutations as unknown[]) {
    if (!raw || typeof raw !== "object") bad("mutation");
    const { mid, tbl, rid, fields, ts } = raw as Record<string, unknown>;
    if (typeof mid !== "string" || !mid || mid.length > 64) bad("mid");
    if (typeof tbl !== "string" || !(CLIENT_TABLES as readonly string[]).includes(tbl)) bad("tbl");
    if (typeof rid !== "string" || !rid || rid.length > 120) bad("rid");
    if (typeof ts !== "number" || !Number.isFinite(ts) || ts < 0) bad("ts");
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) bad("fields");
    const entries = Object.entries(fields as Record<string, unknown>);
    if (entries.length === 0 || entries.length > MAX_FIELDS_PER_MUTATION) bad("Anzahl Felder");
    for (const [k, v] of entries) {
      if (!FIELD_NAME_RE.test(k)) bad(`Feldname ${k}`);
      if (JSON.stringify(v ?? null).length > MAX_FIELD_JSON) bad(`Feld ${k} zu groß`);
    }
    out.push({ mid: mid as string, tbl: tbl as Tbl, rid: rid as string, fields: fields as Record<string, Json>, ts: Math.floor(ts as number) });
  }
  return { cursor: cursor as number, mutations: out };
}
