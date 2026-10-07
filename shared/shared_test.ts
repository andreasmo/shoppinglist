import { assertEquals } from "@std/assert";
import { buildSnapshot, productIdFor, type RawRecord } from "./model.ts";
import { parseInput } from "./parse.ts";
import { seedRecords } from "./seed.ts";
import { badgeCount, categoryOrder, items, positionKey, primaryGroups, reorderSlots, storeView } from "./view.ts";

function snapshotWith(entries: Record<string, Record<string, unknown>>, extraProducts: RawRecord[] = []) {
  const raw: RawRecord[] = seedRecords().map((r) => ({ tbl: r.tbl, rid: r.rid, data: r.fields }));
  raw.push(...extraProducts);
  for (const [name, fields] of Object.entries(entries)) {
    raw.push({ tbl: "entry", rid: productIdFor(name), data: { qty: "", checked: false, ...fields } as never });
  }
  return buildSnapshot(raw);
}

const names = (its: { product: { name: string } }[]) => its.map((i) => i.product.name);

Deno.test("parseInput liest Mengen vorne und hinten", () => {
  assertEquals(parseInput("2 milch"), { name: "Milch", qty: "2×" });
  assertEquals(parseInput("Milch 2x"), { name: "Milch", qty: "2×" });
  assertEquals(parseInput("tomaten 500g"), { name: "Tomaten", qty: "500g" });
  assertEquals(parseInput("500 g Hackfleisch"), { name: "Hackfleisch", qty: "500 g" });
  assertEquals(parseInput("Sonnencreme LSF 50"), { name: "Sonnencreme LSF 50", qty: "" });
  assertEquals(parseInput("  Halloumi "), { name: "Halloumi", qty: "" });
});

Deno.test("Produkt-ID ist unabhängig von Schreibweise und Leerzeichen", () => {
  assertEquals(productIdFor(" Milch "), productIdFor("milch"));
  assertEquals(productIdFor("Passierte  Tomaten"), productIdFor("passierte tomaten"));
});

Deno.test("Kaufland zeigt im Modus „alles“ auch Aldi-Artikel, „nur“ nur Exklusives", () => {
  const sumach = { tbl: "product", rid: productIdFor("Sumach"), data: { name: "Sumach", listId: "leb", categoryId: "gewuerz", avail: ["kaufland"] } };
  const s = snapshotWith({ Milch: {}, Sumach: {}, Bananen: { checked: true } }, [sumach]);
  const all = items(s);

  const alles = storeView(s, all, { storeId: "kaufland", mode: "alles", done: "inline" });
  assertEquals(alles.groups.flatMap((g) => names(g.items)), ["Bananen", "Milch", "Sumach"]); // Laufweg Kaufland: Obst → Kühlregal → … → Gewürze

  const nur = storeView(s, all, { storeId: "kaufland", mode: "nur", done: "inline" });
  assertEquals(nur.groups.flatMap((g) => names(g.items)), ["Sumach"]);

  assertEquals(badgeCount(all, "kaufland"), 1);
  assertEquals(badgeCount(all, "aldi"), 1); // Bananen ist abgehakt und zählt nicht
});

Deno.test("Abgehakte Einträge behalten ihre Position; ausblenden entfernt sie nur", () => {
  const s = snapshotWith({ Milch: {}, Butter: { checked: true }, Joghurt: {} });
  const all = items(s);
  const shown = storeView(s, all, { storeId: "aldi", mode: "alles", done: "inline" });
  assertEquals(names(shown.groups[0].items), ["Butter", "Joghurt", "Milch"]);
  const hidden = storeView(s, all, { storeId: "aldi", mode: "alles", done: "aus" });
  assertEquals(names(hidden.groups[0].items), ["Joghurt", "Milch"]);
  assertEquals(hidden.done, []);
});

Deno.test("Erledigte „unten“: offene im Laufweg, Erledigte gesammelt am Ende", () => {
  const s = snapshotWith({ Milch: { checked: true }, Bananen: {}, Butter: { checked: true }, Joghurt: {} });
  const v = storeView(s, items(s), { storeId: "kaufland", mode: "alles", done: "unten" });
  assertEquals(v.groups.flatMap((g) => names(g.items)), ["Bananen", "Joghurt"]);
  assertEquals(names(v.done), ["Butter", "Milch"]);

  const plan = primaryGroups(s, items(s), "leb", "unten");
  assertEquals(plan.groups.flatMap((g) => names(g.items)), ["Bananen", "Joghurt"]);
  assertEquals(names(plan.done), ["Butter", "Milch"]);
});

Deno.test("Geschäfts-Ansicht mischt alle Listen in einen Laufweg, nicht Erhältliches separat", () => {
  const s = snapshotWith({ Milch: {}, Pflaster: {}, Zahnpasta: {} });
  const all = items(s);
  const v = storeView(s, all, { storeId: "aldi", mode: "alles", done: "inline" });
  assertEquals(v.groups.flatMap((g) => names(g.items)).sort(), ["Milch", "Zahnpasta"]);
  assertEquals(names(v.notHere), ["Pflaster"]);
});

Deno.test("Planungsansicht gruppiert nach primärem Geschäft", () => {
  const s = snapshotWith({ Milch: {}, Hafermilch: {}, Pflaster: {}, Sonnencreme: { onlyStore: "kaufland" } });
  const all = items(s);
  assertEquals(primaryGroups(s, all, "leb", "inline").groups.map((g) => [g.store.name, names(g.items)]), [["Aldi", ["Milch", "Hafermilch"]]]); // Laufweg: Kühlregal vor Vorrat
  assertEquals(primaryGroups(s, all, "dro", "inline").groups.map((g) => [g.store.name, names(g.items)]), [
    ["dm", ["Pflaster"]],
    ["Kaufland", ["Sonnencreme"]],
  ]);
});

Deno.test("Manuelle Reihenfolge: Positionen vor Name, nicht angezeigte behalten ihren Platz", () => {
  assertEquals(reorderSlots(["a", "b", "c", "d", "e"], ["d", "b"]), ["a", "d", "c", "b", "e"]);
  assertEquals(positionKey(0) < positionKey(1) && positionKey(9) < positionKey(10), true);

  const raw: RawRecord[] = seedRecords().map((r) => ({ tbl: r.tbl, rid: r.rid, data: r.fields }));
  raw.push({ tbl: "product", rid: productIdFor("Milch"), data: { name: "Milch", listId: "leb", categoryId: "kuehl", avail: ["aldi"], "pos:aldi": positionKey(1) } });
  raw.push({ tbl: "product", rid: productIdFor("Sahne"), data: { name: "Sahne", listId: "leb", categoryId: "kuehl", avail: ["aldi"], "pos:aldi": positionKey(0) } });
  for (const n of ["Milch", "Sahne", "Butter"]) raw.push({ tbl: "entry", rid: productIdFor(n), data: { checked: false } });
  const s = buildSnapshot(raw);
  const v = storeView(s, items(s), { storeId: "aldi", mode: "alles", done: "inline" });
  assertEquals(names(v.groups[0].items), ["Sahne", "Milch", "Butter"]); // Butter ohne Position ans Ende
  assertEquals(categoryOrder(s, "aldi", "kuehl").slice(0, 2).map((p) => p.name), ["Sahne", "Milch"]);
});

Deno.test("Gelöschte Datensätze tauchen nicht auf", () => {
  const s = buildSnapshot([
    { tbl: "entry", rid: "p:x", data: { _deleted: true } },
    { tbl: "store", rid: "aldi", data: { name: "Aldi" } },
  ]);
  assertEquals(s.entries.size, 0);
  assertEquals(s.stores.size, 1);
});
