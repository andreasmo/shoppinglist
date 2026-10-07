// Ansichtslogik: Welche Einträge zeigt ein Geschäft, in welcher Reihenfolge?
// Reine Funktionen über einem Snapshot – genutzt von der App und den Tests.
import type { Category, Entry, List, Product, Snapshot, Store } from "./model.ts";

export type Mode = "alles" | "nur";
/** Erledigte: an ihrem Platz („inline“), gesammelt am Ende („unten“) oder ausgeblendet („aus“). */
export type DoneMode = "inline" | "unten" | "aus";

export interface Item {
  entry: Entry;
  product: Product;
  list: List;
  /** Das Geschäft, in dem dieser Eintrag gekauft wird (erstes passendes nach Priorität). */
  primary: string | null;
}

export interface CategoryGroup {
  category: Category;
  items: Item[];
  open: number;
}

export interface StoreView {
  groups: CategoryGroup[];
  /** Erledigte im Modus „unten“, in Laufweg-Reihenfolge; sonst leer. */
  done: Item[];
  notHere: Item[];
}

export interface PrimaryGroup {
  store: Store;
  items: Item[];
  open: number;
}

export interface PlanView {
  groups: PrimaryGroup[];
  /** Erledigte im Modus „unten“, in der Reihenfolge der Gruppen; sonst leer. */
  done: Item[];
}

const FALLBACK_CATEGORY: Category = { id: "sonst", name: "Sonstiges", sort: 999 };

export function primaryStore(entry: Entry, product: Product, list: List | undefined): string | null {
  if (entry.onlyStore) return entry.onlyStore;
  for (const s of list?.storeIds ?? []) if (product.avail.includes(s)) return s;
  return product.avail[0] ?? null;
}

export function isAvailableAt(item: Item, storeId: string): boolean {
  return item.entry.onlyStore ? item.entry.onlyStore === storeId : item.product.avail.includes(storeId);
}

/** Erscheint der Eintrag in der Ansicht dieses Geschäfts (abgehakt oder nicht)? */
export function shownAt(item: Item, storeId: string, mode: Mode): boolean {
  return mode === "nur" ? item.primary === storeId : isAvailableAt(item, storeId);
}

/** Muss man für diesen Eintrag eigens in dieses Geschäft (und es ist nicht das Hauptgeschäft der Liste)? */
export function isExclusive(item: Item, storeId: string): boolean {
  return item.primary === storeId && item.list.storeIds[0] !== storeId;
}

/** Alle Einträge mit Produkt und Liste; Einträge ohne Produkt/Liste werden übersprungen. */
export function items(s: Snapshot): Item[] {
  const out: Item[] = [];
  for (const entry of s.entries.values()) {
    const product = s.products.get(entry.id);
    if (!product) continue;
    const list = s.lists.get(product.listId) ?? defaultList(s);
    if (!list) continue;
    out.push({ entry, product, list, primary: primaryStore(entry, product, list) });
  }
  return out;
}

export function sortedLists(s: Snapshot): List[] {
  return [...s.lists.values()].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "de"));
}

export function sortedStores(s: Snapshot): Store[] {
  return [...s.stores.values()].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "de"));
}

export function sortedCategories(s: Snapshot): Category[] {
  return [...s.categories.values()].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "de"));
}

export function defaultList(s: Snapshot): List | undefined {
  const lists = sortedLists(s);
  return lists.find((l) => l.isDefault) ?? lists[0];
}

/** Reihenfolge der Warengruppen im Laden; nicht im Laufweg enthaltene Gruppen kommen ans Ende. */
export function routeOf(s: Snapshot, storeId: string): string[] {
  const route = [...(s.stores.get(storeId)?.route ?? [])];
  for (const c of sortedCategories(s)) if (!route.includes(c.id)) route.push(c.id);
  return route;
}

/** Stabile Sortierung: Laufweg → manuelle Position → Name. Abgehakt spielt keine Rolle. */
export function sortForStore(s: Snapshot, list: Item[], storeId: string): Item[] {
  const route = routeOf(s, storeId);
  const rank = (c: string) => {
    const i = route.indexOf(c);
    return i < 0 ? route.length : i;
  };
  return [...list].sort((a, b) =>
    rank(a.product.categoryId) - rank(b.product.categoryId) ||
    comparePos(a.product, b.product, storeId) ||
    a.product.name.localeCompare(b.product.name, "de")
  );
}

/** Manuelle Position (Schlüssel werden binär verglichen); ohne Position ans Ende. */
export function comparePos(a: Product, b: Product, storeId: string): number {
  const pa = a.pos[storeId] ?? "￿";
  const pb = b.pos[storeId] ?? "￿";
  return pa < pb ? -1 : pa > pb ? 1 : 0;
}

/** Alle Produkte einer Warengruppe in der Reihenfolge eines Ladens (auch die nicht auf der Liste). */
export function categoryOrder(s: Snapshot, storeId: string, categoryId: string): Product[] {
  return [...s.products.values()]
    .filter((p) => p.categoryId === categoryId)
    .sort((a, b) => comparePos(a, b, storeId) || a.name.localeCompare(b.name, "de"));
}

/**
 * Nach Drag & Drop: Die angezeigten Produkte tauschen ihre Plätze untereinander,
 * alle anderen (z. B. gerade nicht auf der Liste) bleiben, wo sie sind.
 */
export function reorderSlots(fullOrder: string[], newVisible: string[]): string[] {
  const visible = new Set(newVisible);
  let k = 0;
  return fullOrder.map((id) => (visible.has(id) ? newVisible[k++] : id));
}

/** Positionsschlüssel: lexikographisch sortierbar, mit Luft für spätere Verfeinerung. */
export function positionKey(index: number): string {
  return String((index + 1) * 10).padStart(6, "0");
}

function groupByCategory(s: Snapshot, sorted: Item[]): CategoryGroup[] {
  const groups: CategoryGroup[] = [];
  for (const it of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.category.id === it.product.categoryId) {
      last.items.push(it);
    } else {
      const category = s.categories.get(it.product.categoryId) ?? { ...FALLBACK_CATEGORY, id: it.product.categoryId };
      groups.push({ category, items: [it], open: 0 });
    }
  }
  for (const g of groups) g.open = g.items.filter((i) => !i.entry.checked).length;
  return groups;
}

export interface StoreViewOptions {
  storeId: string;
  mode: Mode;
  done: DoneMode;
}

/** Ansicht eines Geschäfts: alle Listen zusammen in einem Laufweg – im Laden spielt die Liste keine Rolle. */
export function storeView(s: Snapshot, all: Item[], o: StoreViewOptions): StoreView {
  const sorted = sortForStore(s, all.filter((it) => shownAt(it, o.storeId, o.mode)), o.storeId);
  const inline = o.done === "inline";
  const groups = groupByCategory(s, inline ? sorted : sorted.filter((it) => !it.entry.checked));
  const done = o.done === "unten" ? sorted.filter((it) => it.entry.checked) : [];

  const notHere = all
    .filter((it) => !it.entry.checked && !isAvailableAt(it, o.storeId))
    .sort((a, b) => a.product.name.localeCompare(b.product.name, "de"));

  return { groups, done, notHere };
}

/** Planungsansicht „Alle“: Einträge einer Liste, gruppiert nach dem Geschäft, in dem sie gekauft werden. */
export function primaryGroups(s: Snapshot, all: Item[], listId: string, doneMode: DoneMode): PlanView {
  const list = s.lists.get(listId);
  if (!list) return { groups: [], done: [] };
  const mine = all.filter((it) => it.list.id === listId);
  const storeIds = [...list.storeIds];
  for (const it of mine) if (it.primary && !storeIds.includes(it.primary)) storeIds.push(it.primary);
  const groups: PrimaryGroup[] = [];
  const done: Item[] = [];
  for (const id of storeIds) {
    const store = s.stores.get(id);
    if (!store) continue;
    const sorted = sortForStore(s, mine.filter((it) => it.primary === id), id);
    const its = doneMode === "inline" ? sorted : sorted.filter((i) => !i.entry.checked);
    if (doneMode === "unten") done.push(...sorted.filter((i) => i.entry.checked));
    if (its.length) groups.push({ store, items: its, open: its.filter((i) => !i.entry.checked).length });
  }
  return { groups, done };
}

/** Tab-Badge: offene Einträge (aller Listen), für die man eigens in dieses Geschäft muss. */
export function badgeCount(all: Item[], storeId: string): number {
  return all.filter((it) => !it.entry.checked && it.primary === storeId).length;
}
