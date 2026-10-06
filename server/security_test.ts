import { assert, assertEquals, assertRejects } from "@std/assert";
import type { Mutation } from "../shared/model.ts";
import { packSyncMutations } from "../shared/syncTransport.ts";
import { createApp, MAX_BODY_BYTES } from "./app.ts";
import { authenticate, createHousehold, createInvite, joinHousehold, revokeMember } from "./auth.ts";
import { sqliteDb } from "./db/sqlite.ts";
import type { Db } from "./db/types.ts";
import { migrate, splitSql } from "./migrate.ts";
import { parseSyncRequest, sync } from "./sync.ts";

async function fixture() {
  const db = sqliteDb(":memory:");
  await migrate(db, new URL("./migrations/", import.meta.url));
  const session = await createHousehold(db, "Test", "Anna");
  const owner = await authenticate(db, `Bearer ${session.token}`);
  return { db, session, owner };
}

Deno.test("Entfernen widerruft alte Einladungen des Haushalts, andere Haushalte bleiben unberührt", async () => {
  const { db, owner } = await fixture();
  try {
    const original = await createInvite(db, owner);
    const guestSession = await joinHousehold(db, original.code, "Ben");
    const guest = await authenticate(db, `Bearer ${guestSession.token}`);
    const saved = await createInvite(db, guest);
    const other = await createHousehold(db, "Andere", "Eve");
    const otherInvite = await createInvite(db, await authenticate(db, `Bearer ${other.token}`));
    await revokeMember(db, owner, guest.memberId);
    await assertRejects(() => authenticate(db, `Bearer ${guestSession.token}`));
    await assertRejects(() => joinHousehold(db, original.code, "Ben"));
    await assertRejects(() => joinHousehold(db, saved.code, "Ben"));
    await assertRejects(() => createInvite(db, guest));
    assertEquals((await joinHousehold(db, otherInvite.code, "Gast")).householdId, other.householdId);
    const fresh = await createInvite(db, owner);
    assertEquals((await joinHousehold(db, fresh.code, "Neu")).householdId, owner.householdId);
  } finally {
    db.close();
  }
});

Deno.test("Beitritt prüft die Einladung atomar auch bei gleichzeitigem Entfernen", async () => {
  const { db, owner } = await fixture();
  try {
    const invitation = await createInvite(db, owner);
    const guest = await joinHousehold(db, invitation.code, "Ben");
    // Vor dem eigentlichen Join-Batch gewinnt eine konkurrierende Widerrufs-Transaktion.
    const delayed: Db = {
      ...db,
      async batch(stmts) {
        await revokeMember(db, owner, guest.memberId);
        return db.batch(stmts);
      },
    };
    await assertRejects(() => joinHousehold(delayed, invitation.code, "Zu spät"));
    assertEquals((await db.execute("SELECT COUNT(*) AS n FROM members WHERE name = ?", ["Zu spät"]))[0].n, 0);
  } finally {
    db.close();
  }
});

Deno.test("Retry einer gekappten Mutation überschreibt keine neuere Änderung", async () => {
  const { db, session } = await fixture();
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    const old: Mutation = { mid: "old", tbl: "entry", rid: "p:a", fields: { qty: "alt" }, ts: now + 86400000 };
    await sync(db, session.householdId, { cursor: 0, mutations: [old] });
    now += 120000;
    await sync(db, session.householdId, { cursor: 0, mutations: [{ ...old, mid: "new", ts: now, fields: { qty: "neu" } }] });
    now += 120000;
    const result = await sync(db, session.householdId, { cursor: 0, mutations: [old] });
    assertEquals(result.rows.find((r) => r[1] === "p:a" && r[2] === "qty")?.[3], '"neu"');
    const other = await createHousehold(db, "Andere", "Eve");
    await sync(db, other.householdId, { cursor: 0, mutations: [old] });
    const timestamps = await db.execute("SELECT ts FROM mutation_timestamps WHERE mid = 'old' ORDER BY ts");
    assertEquals(timestamps.length, 2);
    assert(Number(timestamps[1].ts) > Number(timestamps[0].ts));
  } finally {
    Date.now = realNow;
    db.close();
  }
});

Deno.test("Aufgeteilte große Mutationen behalten alle Felder auch nach Paket-Retries", async () => {
  const { db, session } = await fixture();
  try {
    const fields = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`note${i}`, "あ".repeat(3998)]));
    const mutation: Mutation = { mid: "large", tbl: "entry", rid: "p:large", ts: Date.now() + 86400000, fields };
    const packets = packSyncMutations([mutation]);
    assert(packets.length > 1);
    for (const mutations of [...packets, ...packets]) {
      await sync(db, session.householdId, parseSyncRequest({ cursor: 0, mutations }));
    }
    const stored = await db.execute("SELECT field, value FROM fields WHERE household_id = ? AND rid = ?", [
      session.householdId,
      "p:large",
    ]);
    assertEquals(Object.fromEntries(stored.map((r) => [r.field, JSON.parse(String(r.value))])), fields);
  } finally {
    db.close();
  }
});

Deno.test("Zu große Bodies werden beim Streamen abgebrochen, unabhängig von Content-Length", async () => {
  const { db } = await fixture();
  try {
    const app = createApp({ db, allowedOrigins: [], setupCode: "secret" });
    for (const length of [undefined, "1", String(MAX_BODY_BYTES + 1)]) {
      let read = 0;
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          read += 16384;
          controller.enqueue(new Uint8Array(16384).fill(32));
        },
        cancel() {
          cancelled = true;
        },
      });
      const response = await app.fetch(
        new Request("https://test.invalid/api/join", {
          method: "POST",
          body,
          headers: length ? { "Content-Length": length } : {},
        }),
      );
      assertEquals(response.status, 413);
      assert(read <= MAX_BODY_BYTES + 2 * 16384);
      assert(cancelled);
      assertEquals(response.headers.get("Cache-Control"), "no-store");
    }
  } finally {
    db.close();
  }
});

Deno.test("Body-Limit zählt UTF-8-Bytes und dekodiert über Chunk-Grenzen", async () => {
  const { db } = await fixture();
  try {
    const app = createApp({ db, allowedOrigins: [], setupCode: "secret" });
    const tooLarge = JSON.stringify({ code: "invalid", memberName: "Name", padding: "あ".repeat(200000) });
    assertEquals((await app.request("/api/join", { method: "POST", body: tooLarge })).status, 413);
    const bytes = new TextEncoder().encode(JSON.stringify({ memberName: "Änne 🛒", setupCode: "secret" }));
    let offset = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === bytes.length) controller.close();
        else controller.enqueue(bytes.slice(offset, ++offset));
      },
    });
    const response = await app.fetch(new Request("https://test.invalid/api/households", { method: "POST", body }));
    assertEquals(response.status, 201);
    assertEquals((await response.json()).memberName, "Änne 🛒");
  } finally {
    db.close();
  }
});

Deno.test("API-Sicherheitsheader gelten auch für Fehler und CORS-Preflight", async () => {
  const { db } = await fixture();
  try {
    const app = createApp({ db, allowedOrigins: ["https://app.invalid"] });
    for (
      const [path, method] of [["/api/health", "GET"], ["/api/me", "GET"], ["/api/missing", "GET"], ["/api/sync", "OPTIONS"]]
    ) {
      const response = await app.request(`https://api.invalid${path}`, { method, headers: { Origin: "https://app.invalid" } });
      assertEquals(response.headers.get("Cache-Control"), "no-store");
      assertEquals(response.headers.get("X-Content-Type-Options"), "nosniff");
      assertEquals(response.headers.get("X-Frame-Options"), "DENY");
      assertEquals(response.headers.get("Strict-Transport-Security"), "max-age=31536000");
      assertEquals(response.headers.get("Access-Control-Allow-Origin"), "https://app.invalid");
    }
  } finally {
    db.close();
  }
});

Deno.test("Migration übernimmt Zeitstempel bestehender Daten ohne deren Sync-Stand zu verändern", async () => {
  const db = sqliteDb(":memory:");
  try {
    const schema = await Deno.readTextFile(new URL("./migrations/0001_init.sql", import.meta.url));
    await db.batch(splitSql(schema).map((sql) => ({ sql })));
    await db.execute("CREATE TABLE __local_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
    await db.execute("INSERT INTO __local_migrations VALUES ('0001_init.sql', 0)");
    const session = await createHousehold(db, "Bestehend", "Anna");
    await db.execute(
      "INSERT INTO fields VALUES (?, 'entry', 'p:a', 'qty', ?, 123, 'legacy', 100)",
      [session.householdId, '"alt"'],
    );
    const before = await db.execute("SELECT * FROM fields ORDER BY household_id, tbl, rid, field");
    assertEquals(await migrate(db, new URL("./migrations/", import.meta.url)), ["0002_mutation_timestamps.sql"]);
    assertEquals(await db.execute("SELECT * FROM fields ORDER BY household_id, tbl, rid, field"), before);
    assertEquals(await db.execute("SELECT mid, ts FROM mutation_timestamps"), [{ mid: "legacy", ts: 123 }]);
    assertEquals(await migrate(db, new URL("./migrations/", import.meta.url)), []);
  } finally {
    db.close();
  }
});
