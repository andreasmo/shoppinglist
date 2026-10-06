import { assert, assertEquals, assertRejects } from "@std/assert";
import type { Mutation, SyncRequest } from "./model.ts";
import { exchangeSync, packSyncMutations, selectSyncBatch, SYNC_PACKET_BYTES, SYNC_PACKET_MUTATIONS } from "./syncTransport.ts";

export const largeMutation = (mid = "large"): Mutation => ({
  mid,
  tbl: "entry",
  rid: "p:test",
  ts: 123,
  fields: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`note${i}`, "あ".repeat(3998)])),
});

Deno.test("Sync-Pakete begrenzen UTF-8-Bytes ohne Felder oder Mutations-IDs zu verlieren", () => {
  const originals = Array.from({ length: 3 }, (_, i) => largeMutation(`mid${i}`));
  const packets = packSyncMutations(originals);
  assert(packets.length > originals.length);
  for (const mutations of packets) {
    assert(mutations.length <= SYNC_PACKET_MUTATIONS);
    assert(new TextEncoder().encode(JSON.stringify({ cursor: Number.MAX_SAFE_INTEGER, mutations })).length <= SYNC_PACKET_BYTES);
  }
  for (const original of originals) {
    const pieces = packets.flat().filter((m) => m.mid === original.mid);
    const fields = Object.assign({}, ...pieces.map((m) => m.fields));
    assertEquals(fields, original.fields);
    assertEquals(pieces.reduce((n, m) => n + Object.keys(m.fields).length, 0), 40);
    assert(pieces.every((m) => m.ts === original.ts && m.tbl === original.tbl && m.rid === original.rid));
  }
  assertEquals(packSyncMutations(originals), packets);
});

Deno.test("Sync-Pakete begrenzen auch die Anzahl und erlauben reine Pulls", () => {
  const small: Mutation = { mid: "m", tbl: "entry", rid: "p:a", ts: 1, fields: { qty: "1" } };
  assertEquals(packSyncMutations(Array(401).fill(small)).map((p) => p.length), [200, 200, 1]);
  assertEquals(packSyncMutations([]), [[]]);
});

Deno.test("Mehrere Sync-Pakete führen Antworten zusammen und reichen den Cursor weiter", async () => {
  const seen: SyncRequest[] = [];
  const result = await exchangeSync({ cursor: 7, mutations: [largeMutation()] }, (req) => {
    seen.push(req);
    return Promise.resolve({
      cursor: req.cursor + 1,
      rows: [["entry", "p:a", "qty", '"1"', req.cursor + 1]],
      hasMore: seen.length === 1,
    });
  });
  assert(seen.length > 1);
  assertEquals(seen.map((s) => s.cursor), seen.map((_, i) => 7 + i));
  assertEquals(result.rows.length, seen.length);
  assertEquals(result.cursor, 7 + seen.length);
  assertEquals(result.hasMore, false);
});

Deno.test("Ein fehlgeschlagenes Teilpaket bestätigt keine gesamte Outbox", async () => {
  let calls = 0;
  await assertRejects(
    () =>
      exchangeSync({ cursor: 0, mutations: [largeMutation()] }, () => {
        if (++calls === 2) throw new Error("offline");
        return Promise.resolve({ cursor: 1, rows: [], hasMore: false });
      }),
    Error,
    "offline",
  );
  assertEquals(calls, 2);
});

Deno.test("Outbox-Portionen bestätigen große Importe schrittweise statt nach allen Paketen", () => {
  const huge = largeMutation();
  const small: Mutation = { mid: "small", tbl: "entry", rid: "p:a", ts: 1, fields: { note: "あ".repeat(3998) } };
  assertEquals(selectSyncBatch([huge, small]), [huge]);
  assertEquals(selectSyncBatch([small, huge]), [small]);
  const outbox = Array.from({ length: 200 }, (_, i) => ({ ...small, mid: `small${i}` }));
  const acknowledged: Mutation[] = [];
  while (outbox.length) {
    const batch = selectSyncBatch(outbox);
    assert(batch.length > 0 && batch.length < 200);
    assert(
      new TextEncoder().encode(JSON.stringify({ cursor: Number.MAX_SAFE_INTEGER, mutations: batch })).length <= SYNC_PACKET_BYTES,
    );
    acknowledged.push(...batch);
    outbox.splice(0, batch.length);
  }
  assertEquals(acknowledged.map((m) => m.mid), Array.from({ length: 200 }, (_, i) => `small${i}`));
});
