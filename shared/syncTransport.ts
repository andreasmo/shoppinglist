import type { Mutation, SyncRequest, SyncResponse } from "./model.ts";

/** Unter dem 256-KB-Prüflimit von Shield Basic, einschließlich JSON und UTF-8. */
export const SYNC_PACKET_BYTES = 240_000;
export const SYNC_PACKET_MUTATIONS = 200;
const encoder = new TextEncoder();
const sizeOf = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength;
const envelopeBytes = sizeOf({ cursor: Number.MAX_SAFE_INTEGER, mutations: [] });

/** Kleine Outbox-Portionen einzeln bestätigen, damit Rate-Limits keinen großen Import neu starten lassen. */
export function selectSyncBatch<T extends Mutation>(items: readonly T[]): T[] {
  const batch: T[] = [];
  let bytes = envelopeBytes;
  for (const item of items) {
    const { mid, tbl, rid, fields, ts } = item;
    const size = sizeOf({ mid, tbl, rid, fields, ts });
    if (batch.length && (batch.length === SYNC_PACKET_MUTATIONS || bytes + 1 + size > SYNC_PACKET_BYTES)) break;
    // Ein großes Einzelobjekt wird von packSyncMutations aufgeteilt, aber gemeinsam bestätigt.
    bytes += (batch.length ? 1 : 0) + size;
    batch.push(item);
  }
  return batch;
}

/**
 * Auch einzelne große Mutationen dürfen mehrere Pakete belegen. Ihre mid und ts
 * bleiben gleich; der Server speichert den effektiven Zeitstempel pro mid einmal.
 */
export function packSyncMutations(mutations: Mutation[]): Mutation[][] {
  const packets: Mutation[][] = [];
  let packet: Mutation[] = [];
  let bytes = envelopeBytes;
  const append = (m: Mutation) => {
    const size = sizeOf(m);
    if (size + envelopeBytes > SYNC_PACKET_BYTES) throw new Error("Ein einzelnes Sync-Feld ist zu groß.");
    if (packet.length && (packet.length === SYNC_PACKET_MUTATIONS || bytes + 1 + size > SYNC_PACKET_BYTES)) {
      packets.push(packet);
      packet = [];
      bytes = envelopeBytes;
    }
    bytes += (packet.length ? 1 : 0) + size;
    packet.push(m);
  };
  for (const m of mutations) {
    if (sizeOf(m) + envelopeBytes <= SYNC_PACKET_BYTES) {
      append(m);
      continue;
    }
    let fields: Mutation["fields"] = {};
    for (const [key, value] of Object.entries(m.fields)) {
      const next = { ...fields, [key]: value };
      if (Object.keys(fields).length && sizeOf({ ...m, fields: next }) + envelopeBytes > SYNC_PACKET_BYTES) {
        append({ ...m, fields });
        fields = {};
      }
      fields = { ...fields, [key]: value };
    }
    append({ ...m, fields });
  }
  if (packet.length || !packets.length) packets.push(packet);
  return packets;
}

/** Erst nach Erfolg aller Pakete darf der Aufrufer die ursprüngliche Outbox bestätigen. */
export async function exchangeSync(
  req: SyncRequest,
  send: (packet: SyncRequest) => Promise<SyncResponse>,
): Promise<SyncResponse> {
  const result: SyncResponse = { cursor: req.cursor, rows: [], hasMore: false };
  for (const mutations of packSyncMutations(req.mutations)) {
    const response = await send({ cursor: result.cursor, mutations });
    result.rows.push(...response.rows);
    result.cursor = response.cursor;
    result.hasMore = response.hasMore;
  }
  return result;
}
