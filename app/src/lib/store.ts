// Zustand der App und Sync-Engine (offline-first).
//
// - `records`: der zuletzt vom Server bestätigte Stand (in IndexedDB gespeichert).
// - `outbox`: eigene Änderungen, die der Server noch nicht bestätigt hat.
// - Die UI sieht immer `records` + `outbox` (optimistisch), egal ob online oder offline.
//
// Ein Sync schickt die Outbox und holt im selben Request alle Änderungen seit dem Cursor.
// Was der Server bestätigt hat, fliegt aus der Outbox; alles andere bleibt obendrauf liegen.
import { buildSnapshot, emptySnapshot, recordKey, type FieldRow, type RawRecord, type RecordData, type SessionInfo, type Snapshot, type Tbl } from "@shared/model.ts";
import { selectSyncBatch } from "@shared/syncTransport.ts";
import { useSyncExternalStore } from "react";
import { api, ApiError, OfflineError } from "./api.ts";
import { ldb, type OutboxItem, type StoredRecord } from "./db.ts";
import { BACKGROUND_SYNC_TAG, mergeRows, toMutation } from "./syncCore.ts";

export type SyncStatus = "idle" | "syncing" | "offline" | "error";

/** Abgleich im Hintergrund, solange die App sichtbar ist (beim Öffnen wird ohnehin sofort abgeglichen). */
const SYNC_INTERVAL_MS = 300_000;
/** Im Einkaufsmodus öfter, damit man Häkchen der anderen schneller sieht. */
const FAST_SYNC_INTERVAL_MS = 30_000;
/** Eigene Änderungen werden kurz gesammelt und dann sofort hochgeladen. */
const PUSH_DELAY_MS = 1_500;

export interface Change {
  tbl: Tbl;
  rid: string;
  fields: RecordData;
}

class AppStore {
  ready = false;
  session: SessionInfo | null = null;
  snapshot: Snapshot = emptySnapshot();
  status: SyncStatus = "idle";
  lastSyncAt = 0;
  lastError = "";
  /** Der Server kennt dieses Gerät nicht mehr (Token widerrufen o. Ä.). */
  sessionLost = false;

  private records = new Map<string, StoredRecord>();
  /** records + outbox, wie die UI sie sieht (auch Gelöschtes) – Grundlage für Export/Import. */
  private merged = new Map<string, RawRecord>();
  private outbox: OutboxItem[] = [];
  private cursor = 0;
  private lastTs = 0;
  private running: Promise<boolean> | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | undefined;
  private loopStarted = false;
  private fast = false;
  private lastAttemptAt = 0;
  private version = 0;
  private listeners = new Set<() => void>();

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getVersion = () => this.version;

  private emit() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  get pending(): number {
    return this.outbox.length;
  }

  async init() {
    await this.loadFromDb();
    this.ready = true;
    this.emit();
    this.startLoop();
    if (this.session) void this.syncNow();
  }

  private async loadFromDb() {
    const [meta, records, outbox] = await Promise.all([ldb.meta.toArray(), ldb.records.toArray(), ldb.outbox.orderBy("ts").toArray()]);
    const m = new Map(meta.map((x) => [x.k, x.v]));
    this.session = (m.get("session") as SessionInfo | undefined) ?? null;
    this.cursor = Number(m.get("cursor") ?? 0);
    this.lastSyncAt = Number(m.get("lastSyncAt") ?? 0);
    this.records = new Map(records.map((r) => [r.key, r]));
    this.outbox = outbox;
    this.lastTs = Math.max(this.lastTs, ...outbox.map((o) => o.ts));
    this.rebuild(false);
  }

  /** Nach Anlegen/Beitreten: alles Lokale verwerfen und mit dem neuen Haushalt starten. */
  async startSession(session: SessionInfo) {
    await ldb.transaction("rw", ldb.records, ldb.outbox, ldb.meta, async () => {
      await Promise.all([ldb.records.clear(), ldb.outbox.clear(), ldb.meta.clear()]);
      await ldb.meta.bulkPut([{ k: "session", v: session }, { k: "cursor", v: 0 }]);
    });
    this.session = session;
    this.sessionLost = false;
    this.records.clear();
    this.outbox = [];
    this.cursor = 0;
    this.rebuild();
    // Android soll den Offline-Speicher nicht aufräumen.
    try {
      await navigator.storage?.persist?.();
    } catch {
      // nicht unterstützt – egal
    }
    await this.syncNow();
  }

  async updateSession(patch: Partial<SessionInfo>) {
    if (!this.session) return;
    this.session = { ...this.session, ...patch };
    await ldb.meta.put({ k: "session", v: this.session });
    this.emit();
  }

  async logout() {
    await Promise.all([ldb.records.clear(), ldb.outbox.clear(), ldb.meta.clear()]);
    this.session = null;
    this.sessionLost = false;
    this.records.clear();
    this.outbox = [];
    this.cursor = 0;
    this.rebuild();
  }

  /** Eine Änderung: sofort lokal sichtbar, landet in der Outbox und wird bald hochgeladen. */
  mutate(tbl: Tbl, rid: string, fields: RecordData) {
    this.mutateMany([{ tbl, rid, fields }]);
  }

  /** Mehrere Änderungen auf einmal (nur ein Neuaufbau der Ansicht). */
  mutateMany(changes: Change[]) {
    if (!changes.length) return;
    const items: OutboxItem[] = changes.map(({ tbl, rid, fields }) => {
      const ts = Math.max(Date.now(), this.lastTs + 1);
      this.lastTs = ts;
      return { mid: crypto.randomUUID(), tbl, rid, fields, ts };
    });
    this.outbox.push(...items);
    void ldb.outbox.bulkAdd(items);
    this.rebuild();
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => void this.syncNow(), PUSH_DELAY_MS);
  }

  /** Einkaufsmodus: häufiger abgleichen. */
  setFast(fast: boolean) {
    this.fast = fast;
  }

  /** Alle Datensätze im aktuellen Stand (inkl. noch nicht synchronisierter Änderungen). */
  rawRecords(): RawRecord[] {
    return [...this.merged.values()];
  }

  private rebuild(emit = true) {
    const merged = new Map<string, RawRecord>(this.records);
    for (const m of this.outbox) {
      const k = recordKey(m.tbl, m.rid);
      merged.set(k, { tbl: m.tbl, rid: m.rid, data: { ...merged.get(k)?.data, ...m.fields } });
    }
    this.merged = merged;
    this.snapshot = buildSnapshot(merged.values());
    if (emit) this.emit();
  }

  private startLoop() {
    if (this.loopStarted) return;
    this.loopStarted = true;
    const due = () => Date.now() - this.lastAttemptAt >= (this.fast ? FAST_SYNC_INTERVAL_MS : SYNC_INTERVAL_MS);
    const tick = (force: boolean) => {
      if (document.visibilityState === "visible" && (force || due())) void this.syncNow();
    };
    setInterval(() => tick(false), 5_000);
    document.addEventListener("visibilitychange", () => tick(true));
    window.addEventListener("online", () => tick(true));
    // Der Service Worker meldet sich, wenn er im Hintergrund abgeglichen hat oder wir übernehmen sollen.
    navigator.serviceWorker?.addEventListener("message", (e: MessageEvent) => {
      if (e.data?.type === "sync-now") void this.syncNow();
      if (e.data?.type === "synced" && !this.running) void this.loadFromDb().then(() => this.emit());
    });
  }

  /** Jetzt abgleichen. Läuft schon ein Abgleich, wartet man auf dessen Ergebnis. */
  syncNow(): Promise<boolean> {
    if (!this.session || this.sessionLost) return Promise.resolve(false);
    this.running ??= this.runSync().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runSync(): Promise<boolean> {
    const session = this.session!;
    let attempted: OutboxItem[] = [];
    this.lastAttemptAt = Date.now();
    this.status = "syncing";
    this.emit();
    try {
      for (let round = 0; round < 50; round++) {
        const batch = selectSyncBatch(this.outbox);
        attempted = batch;
        const res = await api.sync(session.token, { cursor: this.cursor, mutations: batch.map(toMutation) });
        await this.applyPulled(res.rows, res.cursor, batch.map((b) => b.mid));
        if (!res.hasMore && this.outbox.length === 0) break;
      }
      this.status = "idle";
      this.lastError = "";
      this.lastSyncAt = Date.now();
      void ldb.meta.put({ k: "lastSyncAt", v: this.lastSyncAt });
      return true;
    } catch (err) {
      if (err instanceof OfflineError) {
        this.status = "offline";
        if (this.outbox.length) this.registerBackgroundSync();
      } else if (err instanceof ApiError && err.status === 401) {
        this.status = "error";
        this.sessionLost = true;
        this.lastError = err.message;
      } else if (err instanceof ApiError && err.status === 400) {
        // Der Server lehnt Änderungen ab, die er nie annehmen wird – sonst bliebe die Outbox für immer hängen.
        const dropped = attempted.map((o) => o.mid);
        const rejected = new Set(dropped);
        this.outbox = this.outbox.filter((o) => !rejected.has(o.mid));
        await ldb.outbox.bulkDelete(dropped);
        this.rebuild(false);
        this.status = "error";
        this.lastError = `${dropped.length} ungültige Änderung(en) verworfen: ${err.message}`;
      } else {
        this.status = "error";
        this.lastError = err instanceof Error ? err.message : String(err);
      }
      return false;
    } finally {
      this.emit();
    }
  }

  /** Android/Chrome: Outbox hochladen, sobald wieder Netz da ist – auch wenn die App dann geschlossen ist. */
  private registerBackgroundSync() {
    navigator.serviceWorker?.ready
      .then((reg) => (reg as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }).sync?.register(BACKGROUND_SYNC_TAG))
      .catch(() => {});
  }

  private async applyPulled(rows: FieldRow[], cursor: number, acked: string[]) {
    const changed = mergeRows(rows, (k) => this.records.get(k));
    for (const [k, r] of changed) this.records.set(k, r);
    const ack = new Set(acked);
    this.outbox = this.outbox.filter((o) => !ack.has(o.mid));
    this.cursor = cursor;
    await ldb.transaction("rw", ldb.records, ldb.outbox, ldb.meta, async () => {
      if (changed.size) await ldb.records.bulkPut([...changed.values()]);
      if (acked.length) await ldb.outbox.bulkDelete(acked);
      await ldb.meta.put({ k: "cursor", v: cursor });
    });
    this.rebuild();
  }
}

export const store = new AppStore();

/** Rendert die Komponente bei jeder Änderung am Store neu. */
export function useStore(): AppStore {
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store;
}
