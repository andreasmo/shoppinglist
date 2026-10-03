// Gemeinsames Datenmodell für App und Server – bewusst ohne Abhängigkeiten.
//
// Synchronisiert werden „Datensätze“ (tbl + rid) aus einzelnen Feldern. Jedes Feld wird
// unabhängig per Last-Write-Wins zusammengeführt; Löschen ist das Feld `_deleted`.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type RecordData = Record<string, Json>;

export const TABLES = ["store", "list", "category", "product", "entry", "member"] as const;
export type Tbl = typeof TABLES[number];
/** Tabellen, die Clients schreiben dürfen (Mitglieder verwaltet nur der Server). */
export const CLIENT_TABLES: readonly Tbl[] = ["store", "list", "category", "product", "entry"];

/** Regeln für Felder – der Server lehnt alles andere ab, die App hält sich vorher daran. */
export const FIELD_NAME_RE = /^[A-Za-z_][A-Za-z0-9_:.-]{0,60}$/;
export const MAX_FIELD_JSON = 4000;
export const MAX_FIELDS_PER_MUTATION = 40;

export function isValidField(name: string, value: unknown): boolean {
  return FIELD_NAME_RE.test(name) && JSON.stringify(value ?? null).length <= MAX_FIELD_JSON;
}

export interface Mutation {
  /** Eindeutige ID, bricht Gleichstände bei gleichem Zeitstempel. */
  mid: string;
  tbl: Tbl;
  rid: string;
  fields: RecordData;
  /** Millisekunden-Zeitstempel des Clients (monoton pro Gerät). */
  ts: number;
}

export interface SyncRequest {
  cursor: number;
  mutations: Mutation[];
}

/** Ein geändertes Feld: [tbl, rid, field, value als JSON, rev]. */
export type FieldRow = [Tbl, string, string, string, number];

export interface SyncResponse {
  rows: FieldRow[];
  cursor: number;
  hasMore: boolean;
}

export interface SessionInfo {
  token: string;
  memberId: string;
  memberName: string;
  householdId: string;
  householdName: string;
}

export interface Store {
  id: string;
  name: string;
  color: string;
  /** Laufweg: Warengruppen-IDs in der Reihenfolge im Laden. */
  route: string[];
  sort: number;
}

export interface List {
  id: string;
  name: string;
  sort: number;
  /** Geschäfte dieser Liste, Reihenfolge = Priorität. */
  storeIds: string[];
  isDefault: boolean;
}

export interface Category {
  id: string;
  name: string;
  sort: number;
}

export interface Product {
  id: string;
  name: string;
  listId: string;
  categoryId: string;
  /** „Gibt's bei“ – das Tagging. */
  avail: string[];
  /** Position innerhalb der Warengruppe je Geschäft (Feld `pos:<storeId>`). */
  pos: Record<string, string>;
  useCount: number;
  lastUsedAt: number;
}

/** Ein Listeneintrag; seine ID ist die Produkt-ID (ein Artikel steht höchstens einmal drauf). */
export interface Entry {
  id: string;
  qty: string;
  note: string;
  onlyStore: string | null;
  checked: boolean;
  checkedBy: string | null;
  checkedAt: number;
  addedBy: string | null;
  addedAt: number;
}

export interface Member {
  id: string;
  name: string;
  /** Gerät wurde abgemeldet bzw. entfernt. */
  revoked: boolean;
}

export interface Snapshot {
  stores: Map<string, Store>;
  lists: Map<string, List>;
  categories: Map<string, Category>;
  products: Map<string, Product>;
  entries: Map<string, Entry>;
  members: Map<string, Member>;
}

export interface RawRecord {
  tbl: string;
  rid: string;
  data: RecordData;
}

export function recordKey(tbl: string, rid: string): string {
  return `${tbl}\u0000${rid}`;
}

const str = (v: Json | undefined, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: Json | undefined, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const strOrNull = (v: Json | undefined): string | null => (typeof v === "string" && v ? v : null);
const strArr = (v: Json | undefined): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

export function emptySnapshot(): Snapshot {
  return {
    stores: new Map(),
    lists: new Map(),
    categories: new Map(),
    products: new Map(),
    entries: new Map(),
    members: new Map(),
  };
}

/** Baut aus rohen Datensätzen typisierte Objekte; gelöschte Datensätze fallen weg. */
export function buildSnapshot(records: Iterable<RawRecord>): Snapshot {
  const s = emptySnapshot();
  for (const { tbl, rid, data: d } of records) {
    if (d._deleted === true) continue;
    switch (tbl) {
      case "store":
        s.stores.set(rid, { id: rid, name: str(d.name, rid), color: str(d.color, "#5B6470"), route: strArr(d.route), sort: num(d.sort) });
        break;
      case "list":
        s.lists.set(rid, { id: rid, name: str(d.name, rid), sort: num(d.sort), storeIds: strArr(d.storeIds), isDefault: d.isDefault === true });
        break;
      case "category":
        s.categories.set(rid, { id: rid, name: str(d.name, rid), sort: num(d.sort) });
        break;
      case "product": {
        const pos: Record<string, string> = {};
        for (const [k, v] of Object.entries(d)) if (k.startsWith("pos:") && typeof v === "string") pos[k.slice(4)] = v;
        s.products.set(rid, {
          id: rid,
          name: str(d.name, rid),
          listId: str(d.listId),
          categoryId: str(d.categoryId, "sonst"),
          avail: strArr(d.avail),
          pos,
          useCount: num(d.useCount),
          lastUsedAt: num(d.lastUsedAt),
        });
        break;
      }
      case "entry":
        s.entries.set(rid, {
          id: rid,
          qty: str(d.qty),
          note: str(d.note),
          onlyStore: strOrNull(d.onlyStore),
          checked: d.checked === true,
          checkedBy: strOrNull(d.checkedBy),
          checkedAt: num(d.checkedAt),
          addedBy: strOrNull(d.addedBy),
          addedAt: num(d.addedAt),
        });
        break;
      case "member":
        s.members.set(rid, { id: rid, name: str(d.name, "?"), revoked: d.revoked === true });
        break;
    }
  }
  return s;
}

export function normalizeName(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("de");
}

/** Produkt-ID aus dem Namen: Zweimal offline angelegte „Milch“ wird derselbe Artikel. */
export function productIdFor(name: string): string {
  return "p:" + normalizeName(name).slice(0, 80);
}
