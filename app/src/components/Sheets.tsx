import { normalizeName, type Product } from "@shared/model.ts";
import { parseInput } from "@shared/parse.ts";
import { sortedCategories, sortedLists, sortedStores } from "@shared/view.ts";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { Check, Close, Copy, Plus, PlusCircle, Share } from "../icons.tsx";
import { api, OfflineError } from "../lib/api.ts";
import { addToList, removeEntryWithUndo, updateEntry, updateProduct, type NewProduct } from "../lib/actions.ts";
import { store, useStore } from "../lib/store.ts";
import type { Toast } from "./Main.tsx";

function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="sheet-wrap" role="dialog" aria-modal="true" aria-label={label}>
      <button className="sheet-dismiss" aria-label="Schließen" onClick={onClose} />
      <div className="sheet">
        <div className="handle" />
        {children}
      </div>
    </div>
  );
}

function StoreChips({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const s = useStore().snapshot;
  return (
    <div className="chips">
      {sortedStores(s).map((st) => {
        const on = value.includes(st.id);
        return (
          <button
            key={st.id}
            type="button"
            className="chip store"
            aria-pressed={on}
            style={{ "--c": st.color } as CSSProperties}
            // Mindestens ein Geschäft muss übrig bleiben.
            onClick={() => onChange(on ? (value.length > 1 ? value.filter((x) => x !== st.id) : value) : [...value, st.id])}
          >
            {on && <Check size={15} />}
            {st.name}
          </button>
        );
      })}
    </div>
  );
}

function ChoiceChips<T extends { id: string; name: string }>({ options, value, onChange }: { options: T[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button key={o.id} type="button" className="chip" aria-pressed={o.id === value} onClick={() => onChange(o.id)}>
          {o.name}
        </button>
      ))}
    </div>
  );
}

function ProductFields({ draft, onChange }: { draft: NewProduct; onChange: (d: NewProduct) => void }) {
  const s = useStore().snapshot;
  return (
    <>
      <div className="group">
        <span className="label">Gibt’s bei</span>
        <StoreChips value={draft.avail} onChange={(avail) => onChange({ ...draft, avail })} />
      </div>
      <div className="group">
        <span className="label">Warengruppe</span>
        <ChoiceChips options={sortedCategories(s)} value={draft.categoryId} onChange={(categoryId) => onChange({ ...draft, categoryId })} />
      </div>
      <div className="group">
        <span className="label">Liste</span>
        <ChoiceChips options={sortedLists(s)} value={draft.listId} onChange={(listId) => onChange({ ...draft, listId })} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

export function AddSheet({ listId, onClose, onToast }: { listId: string; onClose: () => void; onToast: (t: Toast) => void }) {
  const st = useStore();
  const s = st.snapshot;
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<(NewProduct & { qty: string }) | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!draft) input.current?.focus();
  }, [draft]);

  const parsed = parseInput(q);
  const norm = normalizeName(parsed.name);
  const products = [...s.products.values()];
  const isOpen = (p: Product) => {
    const e = s.entries.get(p.id);
    return !!e && !e.checked;
  };
  const listName = (id: string) => s.lists.get(id)?.name ?? "";
  const meta = (p: Product) =>
    [s.categories.get(p.categoryId)?.name, p.avail.map((id) => s.stores.get(id)?.name ?? id).join(", "), p.listId !== listId ? listName(p.listId) : ""]
      .filter(Boolean)
      .join(" · ");

  const matches = norm
    ? products
      .filter((p) => normalizeName(p.name).includes(norm))
      .sort((a, b) =>
        Number(normalizeName(b.name).startsWith(norm)) - Number(normalizeName(a.name).startsWith(norm)) ||
        b.useCount - a.useCount ||
        a.name.localeCompare(b.name, "de")
      )
      .slice(0, 6)
    : [];
  const exact = products.some((p) => normalizeName(p.name) === norm);
  const used = products.some((p) => p.useCount > 0);
  const suggestions = norm
    ? []
    : products
      .filter((p) => !isOpen(p) && (used ? p.useCount > 0 : p.listId === listId))
      .sort((a, b) => b.useCount - a.useCount || b.lastUsedAt - a.lastUsedAt || a.name.localeCompare(b.name, "de"))
      .slice(0, 12);

  const reset = () => {
    setQ("");
    setDraft(null);
    input.current?.focus(); // gleich den nächsten Artikel eintippen
  };
  const add = (p: Product | NewProduct, qty: string) => {
    const name = p.name;
    const res = addToList(p, qty);
    onToast({ text: res === "added" ? `${name} hinzugefügt${qty ? ` (${qty})` : ""}` : qty ? `${name}: Menge ${qty}` : `${name} steht schon drauf` });
    reset();
  };
  const startDraft = () => {
    if (!parsed.name) return;
    const list = s.lists.get(listId);
    setDraft({ name: parsed.name, qty: parsed.qty, listId, categoryId: "sonst", avail: list?.storeIds.slice(0, 1) ?? [] });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const best = matches.find((p) => normalizeName(p.name) === norm) ?? matches[0];
    if (best) add(best, parsed.qty);
    else startDraft();
  };

  if (draft) {
    return (
      <Sheet label="Neuer Artikel" onClose={onClose}>
        <div className="sheet-head">
          <h3>{draft.name}</h3>
          {draft.qty && <span className="sub">{draft.qty}</span>}
          <button className="icon-btn" aria-label="Zurück" onClick={() => setDraft(null)}>
            <Close />
          </button>
        </div>
        <ProductFields draft={draft} onChange={(d) => setDraft({ ...draft, ...d })} />
        <button className="primary-btn" onClick={() => add(draft, draft.qty)}>
          <Plus /> Hinzufügen
        </button>
      </Sheet>
    );
  }

  return (
    <Sheet label="Artikel hinzufügen" onClose={onClose}>
      <form className="field" onSubmit={submit}>
        <label htmlFor="add-q" className="sr">Artikel</label>
        <input
          id="add-q"
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="z. B. 2 Milch oder Tomaten 500g"
          autoComplete="off"
          enterKeyHint="done"
        />
        <button type="button" className="icon-btn" aria-label="Schließen" onClick={onClose}>
          <Close />
        </button>
      </form>
      {norm ? (
        <div className="sugg-list">
          {matches.map((p) => (
            <button key={p.id} className="sugg" onClick={() => add(p, parsed.qty)}>
              <Plus />
              <span className="sugg-text">
                <strong>{p.name}</strong>
                <small>{meta(p)}</small>
              </span>
              {isOpen(p) && <span className="pill">steht drauf</span>}
            </button>
          ))}
          {!exact && (
            <button className="sugg" onClick={startDraft}>
              <PlusCircle />
              <span className="sugg-text">
                <strong>„{parsed.name}“ neu anlegen</strong>
                {parsed.qty && <small>Menge {parsed.qty}</small>}
              </span>
            </button>
          )}
        </div>
      ) : (
        suggestions.length > 0 && (
          <div className="group">
            <span className="label">{used ? "Häufig gekauft" : "Vorschläge"}</span>
            <div className="chips">
              {suggestions.map((p) => (
                <button key={p.id} className="chip" onClick={() => add(p, "")}>
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------

const QUICK_QTY = [1, 2, 3, 4, 5];

/** Long-Press-Menü: Menge und Notiz des Eintrags, dazu „Gibt’s bei“, Warengruppe und Liste des Artikels. */
export function EditSheet({ entryId, onClose, onToast }: { entryId: string; onClose: () => void; onToast: (t: Toast) => void }) {
  const s = useStore().snapshot;
  const entry = s.entries.get(entryId);
  const product = s.products.get(entryId);
  const [qty, setQty] = useState(entry?.qty ?? "");
  const [note, setNote] = useState(entry?.note ?? "");
  const [draft, setDraft] = useState<NewProduct>({
    name: product?.name ?? "",
    listId: product?.listId ?? "",
    categoryId: product?.categoryId ?? "sonst",
    avail: product?.avail ?? [],
  });

  useEffect(() => {
    if (!entry || !product) onClose();
  }, [entry, product, onClose]);
  if (!entry || !product) return null;

  const save = (e?: FormEvent) => {
    e?.preventDefault();
    updateEntry(entry.id, {
      ...(qty.trim() !== entry.qty ? { qty: qty.trim() } : {}),
      ...(note.trim() !== entry.note ? { note: note.trim() } : {}),
    });
    updateProduct(product.id, {
      ...(draft.listId !== product.listId ? { listId: draft.listId } : {}),
      ...(draft.categoryId !== product.categoryId ? { categoryId: draft.categoryId } : {}),
      ...(draft.avail.join() !== product.avail.join() ? { avail: draft.avail } : {}),
    });
    onClose();
  };
  const remove = () => {
    const undo = removeEntryWithUndo(entry.id);
    onToast({ text: `${product.name} von der Liste genommen`, undo });
    onClose();
  };

  return (
    <Sheet label={`${product.name} bearbeiten`} onClose={onClose}>
      <div className="sheet-head">
        <h3>{product.name}</h3>
        <button className="icon-btn" aria-label="Schließen ohne Speichern" onClick={onClose}>
          <Close />
        </button>
      </div>
      <form className="group" onSubmit={save}>
        <span className="label" id="qty-label">Menge</span>
        <div className="qty-row" role="group" aria-labelledby="qty-label">
          {QUICK_QTY.map((n) => {
            const value = `${n}×`;
            const on = qty.trim() === value;
            return (
              <button key={n} type="button" className="qty-btn" aria-pressed={on} aria-label={`Menge ${n}`} onClick={() => setQty(on ? "" : value)}>
                {n}
              </button>
            );
          })}
          <span className="field compact">
            <input
              value={QUICK_QTY.some((n) => qty.trim() === `${n}×`) ? "" : qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="andere, z. B. 500 g"
              aria-label="Andere Menge"
              autoComplete="off"
              enterKeyHint="done"
            />
          </span>
        </div>
        <label className="field-label">
          <span className="label">Notiz</span>
          <span className="field">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="z. B. Marke, Sorte" autoComplete="off" enterKeyHint="done" />
          </span>
        </label>
        <button type="submit" hidden />
      </form>
      <ProductFields draft={draft} onChange={setDraft} />
      <div className="btn-row">
        <button className="danger-btn" onClick={remove}>Von der Liste</button>
        <button className="primary-btn" onClick={() => save()}>Fertig</button>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------

export function InviteSheet({ onClose }: { onClose: () => void }) {
  const [invite, setInvite] = useState<{ code: string; expiresAt: number } | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = store.session?.token;
    if (!token) return;
    api.invite(token).then(setInvite, (e) => setError(e instanceof OfflineError ? "Einladen geht nur online." : String(e.message ?? e)));
  }, []);

  const link = invite ? `${location.origin}/#join=${invite.code}` : "";
  const share = async () => {
    try {
      await navigator.share({ title: "Einkaufsliste", text: "Komm in unsere Einkaufsliste:", url: link });
    } catch {
      // abgebrochen
    }
  };
  const copy = async () => {
    await navigator.clipboard.writeText(link);
    setCopied(true);
  };

  return (
    <Sheet label="Mitglied einladen" onClose={onClose}>
      <div className="sheet-head">
        <h3>Mitglied einladen</h3>
        <button className="icon-btn" aria-label="Schließen" onClick={onClose}>
          <Close />
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {!invite && !error && <p className="hint">Einladung wird erstellt…</p>}
      {invite && (
        <>
          <p className="hint">
            Link auf dem anderen Handy öffnen, Namen eingeben – fertig. Der Code gilt bis{" "}
            {new Date(invite.expiresAt).toLocaleDateString("de-DE", { day: "numeric", month: "long" })}.
          </p>
          <div className="invite-code">{invite.code}</div>
          <div className="invite-link">{link}</div>
          <div className="btn-row">
            {"share" in navigator && (
              <button className="primary-btn" onClick={share}>
                <Share /> Teilen
              </button>
            )}
            <button className="secondary-btn" onClick={copy}>
              <Copy /> {copied ? "Kopiert" : "Link kopieren"}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
