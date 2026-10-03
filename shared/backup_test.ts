import { assertEquals, assertThrows } from "@std/assert";
import { importChanges, makeBackup, parseBackup } from "./backup.ts";
import { buildSnapshot, type RawRecord, type RecordData } from "./model.ts";

/** Wendet Änderungen so an, wie Server + App es tun (Felder überschreiben). */
function apply(records: RawRecord[], changes: { tbl: string; rid: string; fields: RecordData }[]): RawRecord[] {
  const map = new Map(records.map((r) => [`${r.tbl}/${r.rid}`, { ...r, data: { ...r.data } }]));
  for (const c of changes) {
    const k = `${c.tbl}/${c.rid}`;
    const prev = map.get(k) ?? { tbl: c.tbl, rid: c.rid, data: {} };
    map.set(k, { ...prev, data: { ...prev.data, ...c.fields } });
  }
  return [...map.values()];
}

const A: RawRecord[] = [
  { tbl: "store", rid: "aldi", data: { name: "Aldi", color: "#2B59C3", route: ["obst"], sort: 0 } },
  { tbl: "list", rid: "leb", data: { name: "Lebensmittel", storeIds: ["aldi"], isDefault: true, sort: 0 } },
  { tbl: "product", rid: "p:milch", data: { name: "Milch", listId: "leb", categoryId: "kuehl", avail: ["aldi"], "pos:aldi": "000010" } },
  { tbl: "entry", rid: "p:milch", data: { qty: "2×", checked: false } },
  { tbl: "entry", rid: "p:alt", data: { _deleted: true, qty: "1×" } },
  { tbl: "member", rid: "m1", data: { name: "Anna" } },
];

Deno.test("Export enthält nur aktive Daten ohne Mitglieder; Import liest ihn wieder ein", () => {
  const backup = makeBackup(A, "Moosies", new Date("2026-10-03T12:00:00Z"));
  assertEquals(backup.records.map((r) => `${r.tbl}/${r.rid}`), ["store/aldi", "list/leb", "product/p:milch", "entry/p:milch"]);
  const { backup: parsed, skipped } = parseBackup(JSON.parse(JSON.stringify(backup)));
  assertEquals(skipped, 0);
  assertEquals(parsed, backup);
});

Deno.test("Import prüft Format und überspringt Ungültiges", () => {
  assertThrows(() => parseBackup({ hallo: 1 }));
  assertThrows(() => parseBackup({ format: "einkaufsliste-backup", version: 2, records: [] }));
  const { backup, skipped } = parseBackup({
    format: "einkaufsliste-backup",
    version: 1,
    records: [
      { tbl: "member", rid: "m1", data: { name: "Eve" } }, // Mitglieder nicht importierbar
      { tbl: "entry", rid: "p:x", data: { qty: "1×", "bad key": 1 } },
    ],
  });
  assertEquals(skipped, 2);
  assertEquals(backup.records, [{ tbl: "entry", rid: "p:x", data: { qty: "1×" } }]);
});

Deno.test("Zusammenführen lässt Vorhandenes stehen, Ersetzen räumt auf", () => {
  const backup = makeBackup([
    { tbl: "product", rid: "p:milch", data: { name: "Milch", listId: "leb", categoryId: "kuehl", avail: ["aldi"] } },
    { tbl: "entry", rid: "p:milch", data: { qty: "5×", checked: false } },
    { tbl: "product", rid: "p:brot", data: { name: "Brot", listId: "leb", categoryId: "brot", avail: ["aldi"] } },
  ]);

  const merged = buildSnapshot(apply(A, importChanges(backup, A, "merge")));
  assertEquals(merged.stores.has("aldi"), true);
  assertEquals(merged.entries.get("p:milch")?.qty, "5×");
  assertEquals(merged.products.get("p:milch")?.pos.aldi, "000010"); // Feld nicht in der Datei → bleibt
  assertEquals(merged.products.has("p:brot"), true);

  const replaced = buildSnapshot(apply(A, importChanges(backup, A, "replace")));
  assertEquals(replaced.stores.size, 0); // nicht in der Datei → gelöscht
  assertEquals(replaced.lists.size, 0);
  assertEquals(replaced.products.get("p:milch")?.pos, {}); // Feld nicht in der Datei → geleert
  assertEquals([...replaced.products.keys()].sort(), ["p:brot", "p:milch"]);
  assertEquals(replaced.members.size, 1); // Mitglieder bleiben unberührt
});

Deno.test("Große Datensätze werden in Mutationen mit höchstens 40 Feldern aufgeteilt", () => {
  const data: RecordData = { name: "Viel" };
  for (let i = 0; i < 90; i++) data[`pos:s${i}`] = String(i);
  const changes = importChanges(makeBackup([{ tbl: "product", rid: "p:viel", data }]), [], "merge");
  assertEquals(changes.length, 3);
  assertEquals(changes.every((c) => Object.keys(c.fields).length <= 40), true);
});
