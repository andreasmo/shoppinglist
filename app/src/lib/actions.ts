// Fachliche Aktionen: übersetzen Nutzeraktionen in Feld-Änderungen.
import { importChanges, makeBackup, type Backup, type ImportMode } from "@shared/backup.ts";
import { normalizeName, productIdFor, type Entry, type Product } from "@shared/model.ts";
import { parseInput } from "@shared/parse.ts";
import { categoryOrder, defaultList, positionKey, reorderSlots, sortedCategories, sortedLists, sortedStores } from "@shared/view.ts";
import { api } from "./api.ts";
import { store, type Change } from "./store.ts";

function me(): string {
  return store.session?.memberId ?? "";
}

const shortId = (prefix: string) => `${prefix}:${crypto.randomUUID().slice(0, 8)}`;
const nextSort = (xs: Iterable<{ sort: number }>) => Math.max(-1, ...[...xs].map((x) => x.sort)) + 1;

export function findProductByName(name: string): Product | undefined {
  const norm = normalizeName(name);
  for (const p of store.snapshot.products.values()) if (normalizeName(p.name) === norm) return p;
  return undefined;
}

/** Freie Produkt-ID für einen neuen Namen (falls ein umbenanntes Produkt die naheliegende ID schon hat). */
function freeProductId(name: string): string {
  const base = productIdFor(name);
  let id = base;
  for (let i = 2; store.snapshot.products.has(id); i++) id = `${base}#${i}`;
  return id;
}

export interface NewProduct {
  name: string;
  listId: string;
  categoryId: string;
  avail: string[];
}

export type AddResult = "added" | "updated";

function addChanges(product: Product | NewProduct, qty: string): { changes: Change[]; result: AddResult } {
  const now = Date.now();
  const changes: Change[] = [];
  let id: string;
  if ("id" in product) {
    id = product.id;
    changes.push({ tbl: "product", rid: id, fields: { useCount: product.useCount + 1, lastUsedAt: now } });
  } else {
    id = freeProductId(product.name);
    changes.push({
      tbl: "product",
      rid: id,
      fields: { _deleted: false, name: product.name.trim(), listId: product.listId, categoryId: product.categoryId, avail: product.avail, useCount: 1, lastUsedAt: now },
    });
  }
  const existing = store.snapshot.entries.get(id);
  if (existing && !existing.checked) {
    if (qty) changes.push({ tbl: "entry", rid: id, fields: { qty } });
    return { changes, result: "updated" };
  }
  changes.push({
    tbl: "entry",
    rid: id,
    fields: { _deleted: false, qty, note: "", onlyStore: null, checked: false, checkedBy: null, checkedAt: 0, addedBy: me(), addedAt: now },
  });
  return { changes, result: "added" };
}

/** Setzt ein (ggf. neues) Produkt auf die Liste. Steht es schon offen drauf, wird nur die Menge übernommen. */
export function addToList(product: Product | NewProduct, qty: string): AddResult {
  const { changes, result } = addChanges(product, qty);
  store.mutateMany(changes);
  return result;
}

/** Hakt ab bzw. holt zurück. Liefert die Rückgängig-Funktion. */
export function toggleChecked(entry: Entry): () => void {
  try {
    navigator.vibrate?.(10);
  } catch {
    // nicht unterstützt
  }
  const checked = !entry.checked;
  store.mutate("entry", entry.id, { checked, checkedBy: checked ? me() : null, checkedAt: checked ? Date.now() : 0 });
  return restorer([entry]);
}

export function updateEntry(id: string, fields: Partial<Pick<Entry, "qty" | "note" | "onlyStore">>) {
  if (Object.keys(fields).length) store.mutate("entry", id, fields);
}

export function updateProduct(id: string, fields: Partial<Pick<Product, "listId" | "categoryId" | "avail">>) {
  if (Object.keys(fields).length) store.mutate("product", id, fields);
}

export function removeEntry(id: string) {
  store.mutate("entry", id, { _deleted: true, checked: false });
}

/** Restore-Funktion für „Rückgängig“: stellt die genannten Einträge in ihrem vorigen Zustand wieder her. */
function restorer(entries: Entry[]): () => void {
  return () =>
    store.mutateMany(entries.map((e) => ({
      tbl: "entry" as const,
      rid: e.id,
      fields: {
        _deleted: false,
        qty: e.qty,
        note: e.note,
        onlyStore: e.onlyStore,
        checked: e.checked,
        checkedBy: e.checkedBy,
        checkedAt: e.checkedAt,
        addedBy: e.addedBy,
        addedAt: e.addedAt,
      },
    })));
}

export function removeEntryWithUndo(id: string): () => void {
  const e = store.snapshot.entries.get(id);
  removeEntry(id);
  return restorer(e ? [e] : []);
}

/** „Einkauf abschließen“: räumt alle abgehakten Einträge ab. Liefert Anzahl und Rückgängig-Funktion. */
export function finishTrip(): { count: number; undo: () => void } {
  const done = [...store.snapshot.entries.values()].filter((e) => e.checked);
  store.mutateMany(done.map((e) => ({ tbl: "entry" as const, rid: e.id, fields: { _deleted: true, checked: false } })));
  return { count: done.length, undo: restorer(done) };
}

export function defaultListId(): string {
  return defaultList(store.snapshot)?.id ?? "";
}

// ---------- Reihenfolge ----------

/** Nach Drag & Drop in einer Warengruppe: neue Positionen für diesen Laden. */
export function reorderProducts(storeId: string, categoryId: string, newVisible: string[]) {
  const s = store.snapshot;
  const order = reorderSlots(categoryOrder(s, storeId, categoryId).map((p) => p.id), newVisible);
  const field = `pos:${storeId}`;
  const changes: Change[] = [];
  order.forEach((pid, i) => {
    const key = positionKey(i);
    if (s.products.get(pid)?.pos[storeId] !== key) changes.push({ tbl: "product", rid: pid, fields: { [field]: key } });
  });
  store.mutateMany(changes);
}

export function setRoute(storeId: string, route: string[]) {
  store.mutate("store", storeId, { route });
}

// ---------- Listen ----------

export function createList(name: string, storeIds: string[]): string {
  const id = shortId("l");
  store.mutate("list", id, { _deleted: false, name: name.trim(), storeIds, isDefault: false, sort: nextSort(store.snapshot.lists.values()) });
  return id;
}

export function updateList(id: string, fields: { name?: string; storeIds?: string[] }) {
  if (Object.keys(fields).length) store.mutate("list", id, fields);
}

export function setDefaultList(id: string) {
  store.mutateMany(
    [...store.snapshot.lists.values()]
      .filter((l) => l.isDefault !== (l.id === id))
      .map((l) => ({ tbl: "list" as const, rid: l.id, fields: { isDefault: l.id === id } })),
  );
}

/** Löscht eine Liste; ihre Artikel wandern in die Standardliste (bzw. die erste andere). */
export function deleteList(id: string) {
  const s = store.snapshot;
  const target = sortedLists(s).filter((l) => l.id !== id).sort((a, b) => Number(b.isDefault) - Number(a.isDefault))[0];
  if (!target) return;
  const changes: Change[] = [...s.products.values()]
    .filter((p) => p.listId === id)
    .map((p) => ({ tbl: "product", rid: p.id, fields: { listId: target.id } }));
  if (s.lists.get(id)?.isDefault) changes.push({ tbl: "list", rid: target.id, fields: { isDefault: true } });
  changes.push({ tbl: "list", rid: id, fields: { _deleted: true } });
  store.mutateMany(changes);
}

// ---------- Geschäfte ----------

export function createStore(name: string, color: string, addToListId?: string): string {
  const s = store.snapshot;
  const id = shortId("s");
  const changes: Change[] = [{
    tbl: "store",
    rid: id,
    fields: { _deleted: false, name: name.trim(), color, route: sortedCategories(s).map((c) => c.id), sort: nextSort(s.stores.values()) },
  }];
  const list = addToListId ? s.lists.get(addToListId) : undefined;
  if (list) changes.push({ tbl: "list", rid: list.id, fields: { storeIds: [...list.storeIds, id] } });
  store.mutateMany(changes);
  return id;
}

export function updateStore(id: string, fields: { name?: string; color?: string }) {
  if (Object.keys(fields).length) store.mutate("store", id, fields);
}

/** Löscht ein Geschäft und nimmt es aus allen Listen. */
export function deleteStore(id: string) {
  const changes: Change[] = [...store.snapshot.lists.values()]
    .filter((l) => l.storeIds.includes(id))
    .map((l) => ({ tbl: "list", rid: l.id, fields: { storeIds: l.storeIds.filter((x) => x !== id) } }));
  changes.push({ tbl: "store", rid: id, fields: { _deleted: true } });
  store.mutateMany(changes);
}

// ---------- Warengruppen ----------

export function createCategory(name: string): string {
  const id = shortId("c");
  store.mutate("category", id, { _deleted: false, name: name.trim(), sort: nextSort(store.snapshot.categories.values()) });
  return id;
}

export function renameCategory(id: string, name: string) {
  store.mutate("category", id, { name: name.trim() });
}

/** Löscht eine Warengruppe; ihre Artikel kommen nach „Sonstiges“ (bzw. in die erste andere Gruppe). */
export function deleteCategory(id: string) {
  const s = store.snapshot;
  const fallback = s.categories.has("sonst") && id !== "sonst" ? "sonst" : sortedCategories(s).find((c) => c.id !== id)?.id;
  if (!fallback) return;
  const changes: Change[] = [...s.products.values()]
    .filter((p) => p.categoryId === id)
    .map((p) => ({ tbl: "product", rid: p.id, fields: { categoryId: fallback } }));
  changes.push({ tbl: "category", rid: id, fields: { _deleted: true } });
  store.mutateMany(changes);
}

// ---------- Import (z. B. aus Listonic als Text geteilt) ----------

/** Eine Zeile Freitext → Name + Menge. Aufzählungszeichen, Kästchen und „(2 l)“ werden verstanden. */
export function parseImportLine(line: string): { name: string; qty: string } | null {
  let t = line.trim().replace(/^([-*•·▢☐☑✓✔]|\[[ xX]?\]|\d+[.)])\s*/, "").trim();
  if (!t || t.endsWith(":")) return null;
  let qty = "";
  const paren = t.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (paren) {
    t = paren[1];
    qty = paren[2].trim();
  }
  const parsed = parseInput(t);
  if (!parsed.name) return null;
  return { name: parsed.name, qty: qty || parsed.qty };
}

export function importText(text: string, listId: string): { added: number; updated: number } {
  const s = store.snapshot;
  const list = s.lists.get(listId);
  const avail = list?.storeIds.slice(0, 1) ?? sortedStores(s).slice(0, 1).map((x) => x.id);
  const changes: Change[] = [];
  let added = 0;
  let updated = 0;
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const item = parseImportLine(line);
    if (!item || seen.has(normalizeName(item.name))) continue;
    seen.add(normalizeName(item.name));
    const product = findProductByName(item.name) ?? { name: item.name, listId, categoryId: "sonst", avail };
    const res = addChanges(product, item.qty);
    changes.push(...res.changes);
    if (res.result === "added") added++;
    else updated++;
  }
  store.mutateMany(changes);
  return { added, updated };
}

// ---------- Sicherung als JSON ----------

/** Lädt alle Daten des Haushalts als JSON-Datei herunter. */
export function exportBackup(): number {
  const backup = makeBackup(store.rawRecords(), store.session?.householdName);
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `einkaufsliste-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return backup.records.length;
}

export function importBackup(backup: Backup, mode: ImportMode): number {
  const changes = importChanges(backup, store.rawRecords(), mode);
  store.mutateMany(changes);
  return changes.length;
}

// ---------- Geräte & Mitglieder (online) ----------

export async function renameMe(name: string) {
  const session = store.session;
  if (!session) return;
  const res = await api.rename(session.token, name);
  await store.updateSession({ memberName: res.name });
  await store.syncNow();
}

export async function removeMember(memberId: string) {
  const session = store.session;
  if (!session) return;
  await api.revoke(session.token, memberId);
  await store.syncNow();
}

/** Dieses Gerät abmelden: Token beim Server ungültig machen (falls online) und lokale Daten löschen. */
export async function signOut() {
  const session = store.session;
  if (session) {
    try {
      await api.revoke(session.token, session.memberId);
    } catch {
      // offline – lokal trotzdem abmelden
    }
  }
  await store.logout();
}
