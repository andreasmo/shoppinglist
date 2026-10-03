// Export/Import aller Daten eines Haushalts als JSON.
//
// Format (Version 1):
// {
//   "format": "einkaufsliste-backup", "version": 1, "exportedAt": "2026-10-03T12:00:00.000Z",
//   "household": "Moosies",
//   "records": [
//     { "tbl": "store",    "rid": "aldi",      "data": { "name": "Aldi", "color": "#2B59C3", "route": ["obst", …], "sort": 0 } },
//     { "tbl": "list",     "rid": "leb",       "data": { "name": "Lebensmittel", "storeIds": ["aldi", …], "isDefault": true, "sort": 0 } },
//     { "tbl": "category", "rid": "obst",      "data": { "name": "Obst & Gemüse", "sort": 0 } },
//     { "tbl": "product",  "rid": "p:milch",   "data": { "name": "Milch", "listId": "leb", "categoryId": "kuehl", "avail": ["aldi"], "pos:aldi": "000010", … } },
//     { "tbl": "entry",    "rid": "p:milch",   "data": { "qty": "2×", "note": "", "checked": false, … } }   ← rid = Produkt-ID
//   ]
// }
// Mitglieder/Geräte gehören nicht dazu – die verwaltet der Server.
import { CLIENT_TABLES, isValidField, MAX_FIELDS_PER_MUTATION, type RawRecord, type RecordData, type Tbl } from "./model.ts";

export const BACKUP_FORMAT = "einkaufsliste-backup";

export interface BackupRecord {
  tbl: Tbl;
  rid: string;
  data: RecordData;
}

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: 1;
  exportedAt: string;
  household?: string;
  records: BackupRecord[];
}

export type ImportMode = "merge" | "replace";

export interface RecordChange {
  tbl: Tbl;
  rid: string;
  fields: RecordData;
}

const isClientTable = (t: unknown): t is Tbl => typeof t === "string" && (CLIENT_TABLES as readonly string[]).includes(t);

/** Aktueller Stand → Sicherung (ohne Gelöschtes und ohne leere Felder). */
export function makeBackup(records: Iterable<RawRecord>, household?: string, now = new Date()): Backup {
  const out: BackupRecord[] = [];
  for (const r of records) {
    if (!isClientTable(r.tbl) || r.data._deleted === true) continue;
    const data: RecordData = {};
    for (const [k, v] of Object.entries(r.data)) if (k !== "_deleted" && v !== null && v !== undefined) data[k] = v;
    out.push({ tbl: r.tbl, rid: r.rid, data });
  }
  const order = CLIENT_TABLES as readonly string[];
  out.sort((a, b) => order.indexOf(a.tbl) - order.indexOf(b.tbl) || a.rid.localeCompare(b.rid));
  return { format: BACKUP_FORMAT, version: 1, exportedAt: now.toISOString(), household, records: out };
}

/** Prüft eine eingelesene Datei. Ungültige Datensätze/Felder werden übersprungen und gezählt. */
export function parseBackup(json: unknown): { backup: Backup; skipped: number } {
  if (!json || typeof json !== "object") throw new Error("Keine gültige Sicherung (kein JSON-Objekt).");
  const j = json as Record<string, unknown>;
  if (j.format !== BACKUP_FORMAT) throw new Error("Unbekanntes Format – erwartet wird eine Einkaufsliste-Sicherung.");
  if (j.version !== 1) throw new Error(`Version ${String(j.version)} wird nicht unterstützt.`);
  if (!Array.isArray(j.records)) throw new Error("Die Sicherung enthält keine Datensätze.");
  let skipped = 0;
  const records: BackupRecord[] = [];
  for (const raw of j.records as unknown[]) {
    const r = raw as Record<string, unknown> | null;
    if (!r || !isClientTable(r.tbl) || typeof r.rid !== "string" || !r.rid || r.rid.length > 120 || !r.data || typeof r.data !== "object" || Array.isArray(r.data)) {
      skipped++;
      continue;
    }
    const data: RecordData = {};
    for (const [k, v] of Object.entries(r.data as RecordData)) {
      if (k === "_deleted") continue;
      if (isValidField(k, v)) data[k] = v;
      else skipped++;
    }
    records.push({ tbl: r.tbl, rid: r.rid, data });
  }
  return {
    backup: {
      format: BACKUP_FORMAT,
      version: 1,
      exportedAt: typeof j.exportedAt === "string" ? j.exportedAt : "",
      household: typeof j.household === "string" ? j.household : undefined,
      records,
    },
    skipped,
  };
}

export function countByTable(backup: Backup): Record<Tbl, number> {
  const counts = { store: 0, list: 0, category: 0, product: 0, entry: 0, member: 0 } as Record<Tbl, number>;
  for (const r of backup.records) counts[r.tbl]++;
  return counts;
}

/**
 * Welche Änderungen ein Import auslöst.
 * - merge: Datensätze aus der Datei überschreiben gleichnamige, alles andere bleibt.
 * - replace: danach entspricht der Stand genau der Datei (Rest gelöscht, übrige Felder geleert).
 */
export function importChanges(backup: Backup, existing: Iterable<RawRecord>, mode: ImportMode): RecordChange[] {
  const changes: RecordChange[] = [];
  const push = (tbl: Tbl, rid: string, fields: RecordData) => {
    const entries = Object.entries(fields);
    for (let i = 0; i < entries.length; i += MAX_FIELDS_PER_MUTATION) {
      changes.push({ tbl, rid, fields: Object.fromEntries(entries.slice(i, i + MAX_FIELDS_PER_MUTATION)) });
    }
  };
  const key = (tbl: string, rid: string) => `${tbl}\u0000${rid}`;
  const current = new Map<string, RawRecord>();
  for (const r of existing) if (isClientTable(r.tbl) && r.data._deleted !== true) current.set(key(r.tbl, r.rid), r);
  const incoming = new Set<string>();

  for (const r of backup.records) {
    incoming.add(key(r.tbl, r.rid));
    const fields: RecordData = { _deleted: false, ...r.data };
    if (mode === "replace") {
      const old = current.get(key(r.tbl, r.rid));
      for (const k of Object.keys(old?.data ?? {})) if (!(k in fields) && k !== "_deleted") fields[k] = null;
    }
    push(r.tbl, r.rid, fields);
  }
  if (mode === "replace") {
    for (const [k, r] of current) if (!incoming.has(k)) push(r.tbl as Tbl, r.rid, { _deleted: true });
  }
  return changes;
}
