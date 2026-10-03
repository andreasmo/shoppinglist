// Startdaten für einen neuen Haushalt (Testkonfiguration aus der Spec). Alles davon ist danach
// normal editierbar; der Server schreibt es mit Zeitstempel 1, damit jede Änderung gewinnt.
import type { RecordData, Tbl } from "./model.ts";
import { productIdFor } from "./model.ts";

export interface SeedRecord {
  tbl: Tbl;
  rid: string;
  fields: RecordData;
}

const CATEGORIES: [string, string][] = [
  ["obst", "Obst & Gemüse"],
  ["brot", "Brot & Backwaren"],
  ["kuehl", "Kühlregal"],
  ["fleisch", "Fleisch & Wurst"],
  ["tk", "Tiefkühl"],
  ["vorrat", "Vorrat"],
  ["gewuerz", "Gewürze"],
  ["suess", "Süßes & Snacks"],
  ["getraenke", "Getränke"],
  ["haushalt", "Haushalt"],
  ["pflege", "Körperpflege"],
  ["sonst", "Sonstiges"],
];

const STORES: { id: string; name: string; color: string; route: string[] }[] = [
  {
    id: "aldi",
    name: "Aldi",
    color: "#2B59C3",
    route: ["obst", "brot", "kuehl", "fleisch", "tk", "vorrat", "gewuerz", "suess", "getraenke", "haushalt", "pflege", "sonst"],
  },
  {
    id: "kaufland",
    name: "Kaufland",
    color: "#C7362B",
    route: ["obst", "kuehl", "fleisch", "brot", "vorrat", "gewuerz", "suess", "tk", "getraenke", "haushalt", "pflege", "sonst"],
  },
  {
    id: "dm",
    name: "dm",
    color: "#8C5E0E",
    route: ["pflege", "haushalt", "vorrat", "suess", "getraenke", "gewuerz", "obst", "brot", "kuehl", "fleisch", "tk", "sonst"],
  },
];

const LISTS: { id: string; name: string; storeIds: string[]; isDefault: boolean }[] = [
  { id: "leb", name: "Lebensmittel", storeIds: ["aldi", "kaufland", "dm"], isDefault: true },
  { id: "dro", name: "Drogerie", storeIds: ["dm", "kaufland"], isDefault: false },
];

const A = ["aldi", "kaufland"];
const AD = ["aldi", "kaufland", "dm"];
const D = ["dm", "kaufland"];
const DA = ["dm", "kaufland", "aldi"];

/** Häufige Artikel, damit Autocomplete und Warengruppen von Anfang an funktionieren. */
const PRODUCTS: [name: string, list: string, category: string, avail: string[]][] = [
  ["Bananen", "leb", "obst", A], ["Äpfel", "leb", "obst", A], ["Tomaten", "leb", "obst", A],
  ["Gurke", "leb", "obst", A], ["Paprika", "leb", "obst", A], ["Zwiebeln", "leb", "obst", A],
  ["Kartoffeln", "leb", "obst", A], ["Karotten", "leb", "obst", A], ["Salat", "leb", "obst", A],
  ["Zitronen", "leb", "obst", A], ["Knoblauch", "leb", "obst", A],
  ["Brot", "leb", "brot", A], ["Toastbrot", "leb", "brot", A], ["Brötchen", "leb", "brot", A],
  ["Milch", "leb", "kuehl", A], ["Butter", "leb", "kuehl", A], ["Joghurt", "leb", "kuehl", A],
  ["Käse", "leb", "kuehl", A], ["Eier", "leb", "kuehl", A], ["Quark", "leb", "kuehl", A],
  ["Sahne", "leb", "kuehl", A], ["Frischkäse", "leb", "kuehl", A],
  ["Schinken", "leb", "fleisch", A], ["Hackfleisch", "leb", "fleisch", A], ["Hähnchenbrust", "leb", "fleisch", A],
  ["Tiefkühlpizza", "leb", "tk", A], ["TK-Gemüse", "leb", "tk", A], ["Eis", "leb", "tk", A],
  ["Nudeln", "leb", "vorrat", AD], ["Reis", "leb", "vorrat", A], ["Mehl", "leb", "vorrat", A],
  ["Zucker", "leb", "vorrat", A], ["Haferflocken", "leb", "vorrat", AD], ["Müsli", "leb", "vorrat", AD],
  ["Kaffee", "leb", "vorrat", A], ["Tee", "leb", "vorrat", AD], ["Hafermilch", "leb", "vorrat", AD],
  ["Passierte Tomaten", "leb", "vorrat", A], ["Olivenöl", "leb", "vorrat", A], ["Honig", "leb", "vorrat", A],
  ["Marmelade", "leb", "vorrat", A],
  ["Salz", "leb", "gewuerz", A], ["Pfeffer", "leb", "gewuerz", A],
  ["Schokolade", "leb", "suess", AD], ["Kekse", "leb", "suess", A], ["Chips", "leb", "suess", A],
  ["Mineralwasser", "leb", "getraenke", A], ["Apfelsaft", "leb", "getraenke", A],
  ["Küchenrolle", "leb", "haushalt", AD], ["Toilettenpapier", "leb", "haushalt", AD],
  ["Müllbeutel", "leb", "haushalt", AD], ["Spülmittel", "leb", "haushalt", AD], ["Alufolie", "leb", "haushalt", AD],
  ["Zahnpasta", "dro", "pflege", DA], ["Zahnbürste", "dro", "pflege", D], ["Duschgel", "dro", "pflege", DA],
  ["Shampoo", "dro", "pflege", DA], ["Deo", "dro", "pflege", DA], ["Sonnencreme", "dro", "pflege", D],
  ["Pflaster", "dro", "pflege", D], ["Handcreme", "dro", "pflege", D],
  ["Spülmaschinentabs", "dro", "haushalt", DA], ["Waschmittel", "dro", "haushalt", DA],
  ["Taschentücher", "dro", "haushalt", DA],
];

export function seedRecords(): SeedRecord[] {
  const out: SeedRecord[] = [];
  CATEGORIES.forEach(([id, name], i) => out.push({ tbl: "category", rid: id, fields: { name, sort: i } }));
  STORES.forEach((s, i) => out.push({ tbl: "store", rid: s.id, fields: { name: s.name, color: s.color, route: s.route, sort: i } }));
  LISTS.forEach((l, i) =>
    out.push({ tbl: "list", rid: l.id, fields: { name: l.name, storeIds: l.storeIds, isDefault: l.isDefault, sort: i } })
  );
  for (const [name, listId, categoryId, avail] of PRODUCTS) {
    out.push({ tbl: "product", rid: productIdFor(name), fields: { name, listId, categoryId, avail, useCount: 0, lastUsedAt: 0 } });
  }
  return out;
}
