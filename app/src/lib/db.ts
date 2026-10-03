// Lokale Datenbank (IndexedDB): bestätigter Server-Stand, Outbox mit eigenen Änderungen, Metadaten.
import type { RecordData, Tbl } from "@shared/model.ts";
import { Dexie, type EntityTable } from "dexie";

export interface StoredRecord {
  key: string;
  tbl: string;
  rid: string;
  data: RecordData;
}

export interface OutboxItem {
  mid: string;
  tbl: Tbl;
  rid: string;
  fields: RecordData;
  ts: number;
}

export interface MetaItem {
  k: string;
  v: unknown;
}

export const ldb = new Dexie("einkaufsliste") as Dexie & {
  records: EntityTable<StoredRecord, "key">;
  outbox: EntityTable<OutboxItem, "mid">;
  meta: EntityTable<MetaItem, "k">;
};

ldb.version(1).stores({
  records: "&key",
  outbox: "&mid, ts",
  meta: "&k",
});
