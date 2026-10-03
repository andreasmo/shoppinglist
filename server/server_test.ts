import { assert, assertEquals, assertRejects } from "@std/assert";
import type { FieldRow, Mutation, SessionInfo, SyncResponse } from "../shared/model.ts";
import { createApp } from "./app.ts";
import { createHousehold } from "./auth.ts";
import { sqliteDb } from "./db/sqlite.ts";
import type { Db } from "./db/types.ts";
import { migrate } from "./migrate.ts";
import { parseSyncRequest, sync } from "./sync.ts";

const MIGRATIONS = new URL("./migrations/", import.meta.url);

async function freshDb(): Promise<Db> {
  const db = sqliteDb(":memory:");
  await migrate(db, MIGRATIONS);
  return db;
}

/** Simuliert ein Gerät: hält den Cursor und den bestätigten Stand. */
class Client {
  cursor = 0;
  state = new Map<string, Record<string, unknown>>();
  constructor(private db: Db, private householdId: string) {}
  async sync(mutations: Mutation[] = []): Promise<FieldRow[]> {
    const all: FieldRow[] = [];
    let res: SyncResponse;
    do {
      res = await sync(this.db, this.householdId, { cursor: this.cursor, mutations });
      mutations = [];
      for (const [tbl, rid, field, value] of res.rows) {
        const k = `${tbl}/${rid}`;
        this.state.set(k, { ...this.state.get(k), [field]: JSON.parse(value) });
      }
      all.push(...res.rows);
      this.cursor = res.cursor;
    } while (res.hasMore);
    return all;
  }
  get(tbl: string, rid: string) {
    return this.state.get(`${tbl}/${rid}`) ?? {};
  }
}

const mut = (rid: string, fields: Record<string, unknown>, ts: number, mid: string = crypto.randomUUID()): Mutation =>
  ({ mid, tbl: "entry", rid, fields, ts }) as Mutation;

async function setup() {
  const db = await freshDb();
  const s = await createHousehold(db, "Test", "Anna");
  return { db, s, a: new Client(db, s.householdId), b: new Client(db, s.householdId) };
}

Deno.test("Neuer Haushalt bekommt Seed-Daten und das Mitglied", async () => {
  const { a, s } = await setup();
  await a.sync();
  assertEquals(a.get("list", "leb").name, "Lebensmittel");
  assertEquals(a.get("store", "kaufland").name, "Kaufland");
  assertEquals(a.get("member", s.memberId).name, "Anna");
});

Deno.test("Last-Write-Wins pro Feld: verschiedene Felder werden zusammengeführt", async () => {
  const { a, b } = await setup();
  await a.sync();
  await b.sync();
  await a.sync([mut("p:milch", { qty: "2×" }, 1000)]);
  await b.sync([mut("p:milch", { qty: "3×", note: "laktosefrei" }, 900)]); // älter für qty, neu für note
  await a.sync();
  assertEquals(a.get("entry", "p:milch"), { qty: "2×", note: "laktosefrei" });
  assertEquals(b.get("entry", "p:milch"), { qty: "2×", note: "laktosefrei" });
});

Deno.test("Gleicher Zeitstempel: die größere Mutations-ID gewinnt auf beiden Geräten", async () => {
  const { a, b } = await setup();
  await a.sync([mut("p:milch", { checked: true }, 500, "aaa")]);
  await b.sync([mut("p:milch", { checked: false }, 500, "bbb")]);
  await a.sync();
  assertEquals(a.get("entry", "p:milch").checked, false);
  assertEquals(b.get("entry", "p:milch").checked, false);
});

Deno.test("Erneut gesendete Mutationen ändern nichts (idempotent)", async () => {
  const { a } = await setup();
  const m = mut("p:milch", { qty: "1×" }, 1000);
  await a.sync([m]);
  const again = await a.sync([m]);
  assertEquals(again.length, 0);
});

Deno.test("Gelöscht und wieder hinzugefügt (spätere Änderung gewinnt)", async () => {
  const { a, b } = await setup();
  await a.sync([mut("p:milch", { _deleted: false, qty: "1×" }, 100)]);
  await b.sync([mut("p:milch", { _deleted: true }, 200)]);
  await a.sync();
  assertEquals(a.get("entry", "p:milch")._deleted, true);
  await a.sync([mut("p:milch", { _deleted: false, qty: "2×" }, 300)]);
  await b.sync();
  assertEquals(b.get("entry", "p:milch"), { _deleted: false, qty: "2×" });
});

Deno.test("Uhr in der Zukunft wird gekappt", async () => {
  const { a, b } = await setup();
  await a.sync([mut("p:milch", { qty: "Zukunft" }, Date.now() + 365 * 24 * 3600 * 1000)]);
  await new Promise((r) => setTimeout(r, 5));
  await b.sync([mut("p:milch", { qty: "Jetzt" }, Date.now() + 120_000)]);
  await a.sync();
  assertEquals(a.get("entry", "p:milch").qty, "Jetzt");
});

Deno.test("Haushalte sind voneinander getrennt", async () => {
  const db = await freshDb();
  const h1 = await createHousehold(db, "Eins", "Anna");
  const h2 = await createHousehold(db, "Zwei", "Ben");
  const c1 = new Client(db, h1.householdId);
  const c2 = new Client(db, h2.householdId);
  await c1.sync([mut("p:geheim", { qty: "1×" }, 100)]);
  await c2.sync();
  assertEquals(c2.get("entry", "p:geheim"), {});
});

Deno.test("Sync-Anfragen werden streng geprüft", () => {
  const ok = { cursor: 0, mutations: [{ mid: "x", tbl: "entry", rid: "p:a", fields: { qty: "1" }, ts: 1 }] };
  assertEquals(parseSyncRequest(ok).mutations.length, 1);
  for (const bad of [
    { cursor: -1, mutations: [] },
    { cursor: 0, mutations: [{ ...ok.mutations[0], tbl: "member" }] },
    { cursor: 0, mutations: [{ ...ok.mutations[0], fields: { "bad key": 1 } }] },
    { cursor: 0, mutations: [{ ...ok.mutations[0], fields: {} }] },
  ]) {
    let threw = false;
    try {
      parseSyncRequest(bad);
    } catch {
      threw = true;
    }
    assert(threw, JSON.stringify(bad));
  }
});

Deno.test("HTTP: Haushalt anlegen, einladen, beitreten, synchronisieren", async () => {
  const db = await freshDb();
  const app = createApp({ db, allowedOrigins: ["https://shopping.example"] });
  const call = async (path: string, body?: unknown, token?: string) => {
    const res = await app.request(path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  };

  const created = await call("/api/households", { householdName: "Familie", memberName: "Anna" });
  assertEquals(created.status, 201);
  const anna = created.json as SessionInfo;

  assertEquals((await call("/api/sync", { cursor: 0, mutations: [] })).status, 401);
  assertEquals((await call("/api/sync", { cursor: 0, mutations: [] }, "falsch")).status, 401);

  const invite = await call("/api/invites", {}, anna.token);
  assertEquals(invite.status, 201);
  const joined = await call("/api/join", { code: invite.json.code.toLowerCase(), memberName: "Ben" });
  assertEquals(joined.status, 201);
  const ben = joined.json as SessionInfo;
  assertEquals(ben.householdId, anna.householdId);

  assertEquals((await call("/api/join", { code: "FALSCH12", memberName: "Eve" })).status, 404);

  const pushed = await call("/api/sync", { cursor: 0, mutations: [mut("p:milch", { qty: "2×" }, Date.now())] }, ben.token);
  assertEquals(pushed.status, 200);
  const rows = (pushed.json as SyncResponse).rows;
  assert(rows.some(([tbl, rid, field]) => tbl === "member" && rid === ben.memberId && field === "name"));
  assert(rows.some(([tbl, rid, field, value]) => tbl === "entry" && rid === "p:milch" && field === "qty" && value === '"2×"'));

  const preflight = await app.request("/api/sync", {
    method: "OPTIONS",
    headers: { Origin: "https://shopping.example", "Access-Control-Request-Method": "POST" },
  });
  assertEquals(preflight.headers.get("Access-Control-Allow-Origin"), "https://shopping.example");
  const foreign = await app.request("/api/health", { headers: { Origin: "https://evil.example" } });
  assertEquals(foreign.headers.get("Access-Control-Allow-Origin"), null);
});

Deno.test("Neuen Haushalt anlegen nur mit Einrichtungscode", async () => {
  const db = await freshDb();
  const post = (app: ReturnType<typeof createApp>, body: unknown) =>
    app.request("/api/households", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  const guarded = createApp({ db, allowedOrigins: [], setupCode: "ABCD-EFGH-JKLM-NPQR" });
  assertEquals((await (await guarded.request("/api/health")).json()).setupCodeRequired, true);
  assertEquals((await post(guarded, { memberName: "Eve" })).status, 403);
  assertEquals((await post(guarded, { memberName: "Eve", setupCode: "falsch" })).status, 403);
  assertEquals((await post(guarded, { memberName: "Anna", setupCode: "abcd efgh jklm npqr" })).status, 201); // Schreibweise egal

  const locked = createApp({ db, allowedOrigins: [], setupCode: "" });
  assertEquals((await post(locked, { memberName: "Anna", setupCode: "" })).status, 403);

  const local = createApp({ db, allowedOrigins: [] });
  assertEquals((await (await local.request("/api/health")).json()).setupCodeRequired, false);
  assertEquals((await post(local, { memberName: "Anna" })).status, 201);
});

Deno.test("Geräte umbenennen und entfernen", async () => {
  const db = await freshDb();
  const app = createApp({ db, allowedOrigins: [] });
  const call = async (path: string, body: unknown, token?: string) => {
    const res = await app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  };
  const anna = (await call("/api/households", { memberName: "Anna" })).json as SessionInfo;
  const code = (await call("/api/invites", {}, anna.token)).json.code;
  const ben = (await call("/api/join", { code, memberName: "Ben" })).json as SessionInfo;
  const fremd = (await call("/api/households", { memberName: "Eve" })).json as SessionInfo;

  assertEquals((await call("/api/me", { name: "Benjamin" }, ben.token)).status, 200);
  const c = new Client(db, anna.householdId);
  await c.sync();
  assertEquals(c.get("member", ben.memberId).name, "Benjamin");

  assertEquals((await call(`/api/members/${ben.memberId}/revoke`, {}, fremd.token)).status, 404); // anderer Haushalt
  assertEquals((await call(`/api/members/${ben.memberId}/revoke`, {}, anna.token)).status, 200);
  assertEquals((await call("/api/sync", { cursor: 0, mutations: [] }, ben.token)).status, 401);
  await c.sync();
  assertEquals(c.get("member", ben.memberId).revoked, true);
  assertEquals((await call(`/api/members/${ben.memberId}/revoke`, {}, anna.token)).status, 404); // schon weg
});

Deno.test("Batch ist atomar: Fehler rollt alles zurück", async () => {
  const db = await freshDb();
  await assertRejects(() =>
    db.batch([
      { sql: "INSERT INTO households (id, name, rev, created_at) VALUES ('x', 'X', 0, 0)" },
      { sql: "INSERT INTO gibtsnicht VALUES (1)" },
    ])
  );
  assertEquals((await db.execute("SELECT COUNT(*) AS n FROM households")).at(0)?.n, 0);
});
