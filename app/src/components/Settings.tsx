import { countByTable, parseBackup, type Backup, type ImportMode } from "@shared/backup.ts";
import { routeOf, sortedCategories, sortedLists, sortedStores } from "@shared/view.ts";
import { useEffect, useState, type ChangeEvent, type CSSProperties, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, Close, Download, Import, LogOut, Plus, Trash, UserPlus } from "../icons.tsx";
import {
  createCategory,
  createList,
  createStore,
  deleteCategory,
  deleteList,
  deleteStore,
  exportBackup,
  importBackup,
  importText,
  parseImportLine,
  removeMember,
  renameCategory,
  renameMe,
  setDefaultList,
  setRoute,
  signOut,
  updateList,
  updateStore,
} from "../lib/actions.ts";
import { OfflineError } from "../lib/api.ts";
import { setPrefs, usePrefs, type Theme } from "../lib/prefs.ts";
import { useStore } from "../lib/store.ts";
import type { Toast } from "./Main.tsx";
import { InviteSheet } from "./Sheets.tsx";
import { SortableList } from "./Sortable.tsx";

export type SettingsPage =
  | { kind: "root" }
  | { kind: "list"; id: string | null }
  | { kind: "store"; id: string | null }
  | { kind: "category"; id: string | null }
  | { kind: "members" }
  | { kind: "data" }
  | { kind: "import" };

const COLORS = ["#2B59C3", "#C7362B", "#8C5E0E", "#1F7A4D", "#7A3FB0", "#C2410C", "#0E7490", "#BE185D", "#4B5563", "#4D7C0F"];
const THEMES: [Theme, string][] = [["auto", "Automatisch"], ["light", "Hell"], ["dark", "Dunkel"]];

interface Nav {
  push: (p: SettingsPage) => void;
  replace: (p: SettingsPage) => void;
  back: () => void;
  toast: (t: Toast) => void;
}

const errorText = (e: unknown) => (e instanceof OfflineError ? "Geht nur online." : e instanceof Error ? e.message : String(e));
const dotStyle = (color: string) => ({ "--c": color }) as CSSProperties;

export function Settings({ start, currentListId, onClose, onToast }: { start: SettingsPage; currentListId: string; onClose: () => void; onToast: (t: Toast) => void }) {
  const s = useStore().snapshot;
  const [stack, setStack] = useState<SettingsPage[]>([start]);
  const [inviting, setInviting] = useState(false);
  const page = stack[stack.length - 1];
  const nav: Nav = {
    push: (p) => setStack((st) => [...st, p]),
    replace: (p) => setStack((st) => [...st.slice(0, -1), p]),
    back: () => (stack.length > 1 ? setStack((st) => st.slice(0, -1)) : onClose()),
    toast: onToast,
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !inviting && nav.back();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const title = (() => {
    switch (page.kind) {
      case "root": return "Einstellungen";
      case "list": return page.id ? (s.lists.get(page.id)?.name ?? "Liste") : "Neue Liste";
      case "store": return page.id ? (s.stores.get(page.id)?.name ?? "Geschäft") : "Neues Geschäft";
      case "category": return page.id ? (s.categories.get(page.id)?.name ?? "Warengruppe") : "Neue Warengruppe";
      case "members": return "Geräte & Mitglieder";
      case "data": return "Daten sichern";
      case "import": return "Liste als Text einfügen";
    }
  })();

  return (
    <div className="screen" role="dialog" aria-modal="true" aria-label={title}>
      <header className="screen-head">
        <button className="icon-btn" aria-label="Zurück" onClick={nav.back}>
          <ChevronLeft size={24} />
        </button>
        <h2>{title}</h2>
      </header>
      <div className="screen-body" key={stack.length + page.kind}>
        {page.kind === "root" && <RootPage nav={nav} />}
        {page.kind === "list" && <ListPage id={page.id} nav={nav} />}
        {page.kind === "store" && <StorePage id={page.id} listId={currentListId} nav={nav} />}
        {page.kind === "category" && <CategoryPage id={page.id} nav={nav} />}
        {page.kind === "members" && <MembersPage nav={nav} onInvite={() => setInviting(true)} />}
        {page.kind === "data" && <DataPage nav={nav} />}
        {page.kind === "import" && <ImportPage listId={currentListId} nav={nav} />}
      </div>
      {inviting && <InviteSheet onClose={() => setInviting(false)} />}
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="set-section">
      <span className="label">{label}</span>
      {children}
    </section>
  );
}

function NavRow({ onClick, children, extra }: { onClick: () => void; children: ReactNode; extra?: ReactNode }) {
  return (
    <button className="set-row" onClick={onClick}>
      {children}
      {extra}
      <span className="chev"><ChevronRight size={18} /></span>
    </button>
  );
}

/** Namensfeld, das beim Verlassen speichert (bestehende Objekte) bzw. nur den Entwurf ändert (neue). */
function NameField({ label, value, onChange, onCommit }: { label: string; value: string; onChange: (v: string) => void; onCommit?: () => void }) {
  return (
    <label className="field-label">
      <span className="label">{label}</span>
      <span className="field">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onCommit}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
          maxLength={40}
          enterKeyHint="done"
        />
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------------------------

function RootPage({ nav }: { nav: Nav }) {
  const st = useStore();
  const s = st.snapshot;
  const prefs = usePrefs();
  const activeMembers = [...s.members.values()].filter((m) => !m.revoked).length;
  return (
    <>
      <Section label="Darstellung">
        <div className="seg" role="group" aria-label="Darstellung">
          {THEMES.map(([t, label]) => (
            <button key={t} aria-pressed={prefs.theme === t} onClick={() => setPrefs({ theme: t })}>{label}</button>
          ))}
        </div>
      </Section>

      <Section label="Listen">
        <div className="set-list">
          {sortedLists(s).map((l) => (
            <NavRow key={l.id} onClick={() => nav.push({ kind: "list", id: l.id })} extra={l.isDefault && <span className="pill">Standard</span>}>
              <span className="main">
                <strong>{l.name}</strong>
                <small>{l.storeIds.map((id) => s.stores.get(id)?.name).filter(Boolean).join(" → ") || "keine Geschäfte"}</small>
              </span>
            </NavRow>
          ))}
          <button className="set-row add" onClick={() => nav.push({ kind: "list", id: null })}><Plus /> Liste hinzufügen</button>
        </div>
      </Section>

      <Section label="Geschäfte & Laufweg">
        <div className="set-list">
          {sortedStores(s).map((x) => (
            <NavRow key={x.id} onClick={() => nav.push({ kind: "store", id: x.id })}>
              <span className="dot" style={dotStyle(x.color)} />
              <span className="main"><strong>{x.name}</strong></span>
            </NavRow>
          ))}
          <button className="set-row add" onClick={() => nav.push({ kind: "store", id: null })}><Plus /> Geschäft hinzufügen</button>
        </div>
      </Section>

      <Section label="Warengruppen">
        <div className="set-list">
          {sortedCategories(s).map((c) => (
            <NavRow key={c.id} onClick={() => nav.push({ kind: "category", id: c.id })}>
              <span className="main"><strong>{c.name}</strong></span>
            </NavRow>
          ))}
          <button className="set-row add" onClick={() => nav.push({ kind: "category", id: null })}><Plus /> Warengruppe hinzufügen</button>
        </div>
      </Section>

      <Section label="Haushalt">
        <div className="set-list">
          <NavRow onClick={() => nav.push({ kind: "members" })}>
            <span className="main">
              <strong>Geräte & Mitglieder</strong>
              <small>{st.session?.householdName} · {activeMembers} {activeMembers === 1 ? "Gerät" : "Geräte"}</small>
            </span>
          </NavRow>
          <NavRow onClick={() => nav.push({ kind: "data" })}>
            <span className="main">
              <strong>Daten sichern & wiederherstellen</strong>
              <small>Export und Import als JSON-Datei</small>
            </span>
          </NavRow>
          <NavRow onClick={() => nav.push({ kind: "import" })}>
            <span className="main">
              <strong>Liste als Text einfügen</strong>
              <small>z. B. aus Listonic</small>
            </span>
          </NavRow>
        </div>
      </Section>

      <button
        className="danger-btn"
        onClick={() => confirm("Dieses Gerät abmelden? Danach brauchst du eine neue Einladung.") && void signOut()}
      >
        <LogOut size={20} /> Dieses Gerät abmelden
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function ListPage({ id, nav }: { id: string | null; nav: Nav }) {
  const s = useStore().snapshot;
  const list = id ? s.lists.get(id) : undefined;
  const [name, setName] = useState(list?.name ?? "");
  const [draftStores, setDraftStores] = useState<string[]>(sortedStores(s).slice(0, 1).map((x) => x.id));

  useEffect(() => {
    if (id && !list) nav.back();
  });
  if (id && !list) return null;

  const storeIds = list ? list.storeIds : draftStores;
  const setStoreIds = (ids: string[]) => (list ? updateList(list.id, { storeIds: ids }) : setDraftStores(ids));
  const selected = storeIds.map((x) => s.stores.get(x)).filter((x) => x !== undefined);
  const others = sortedStores(s).filter((x) => !storeIds.includes(x.id));

  return (
    <>
      <NameField label="Name" value={name} onChange={setName} onCommit={() => list && name.trim() && name.trim() !== list.name && updateList(list.id, { name: name.trim() })} />

      <div className="group">
        <span className="label">Geschäfte – Reihenfolge = Priorität</span>
        {selected.length > 0 && (
          <div className="set-list">
            <SortableList items={selected} getId={(x) => x.id} getLabel={(x) => x.name} onReorder={setStoreIds}>
              {(x, handle) => (
                <div className="set-row">
                  <span className="dot" style={dotStyle(x.color)} />
                  <span className="main"><strong>{selected.indexOf(x) + 1}. {x.name}</strong></span>
                  <button className="icon-btn" aria-label={`${x.name} aus der Liste nehmen`} onClick={() => setStoreIds(storeIds.filter((y) => y !== x.id))}>
                    <Close size={18} />
                  </button>
                  {handle}
                </div>
              )}
            </SortableList>
          </div>
        )}
        <p className="hint">Ein Artikel wird beim ersten Geschäft gekauft, das ihn führt. Ganz oben steht das Hauptgeschäft.</p>
        {others.length > 0 && (
          <div className="chips">
            {others.map((x) => (
              <button key={x.id} className="chip store" style={dotStyle(x.color)} onClick={() => setStoreIds([...storeIds, x.id])}>
                <Plus size={16} /> {x.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {list ? (
        <>
          {!list.isDefault && (
            <button className="secondary-btn" onClick={() => setDefaultList(list.id)}><Check size={16} /> Als Standardliste festlegen</button>
          )}
          {s.lists.size > 1 && (
            <button
              className="danger-btn"
              onClick={() => {
                if (!confirm(`Liste „${list.name}“ löschen? Ihre Artikel wandern in die Standardliste.`)) return;
                deleteList(list.id);
                nav.back();
              }}
            >
              <Trash size={18} /> Liste löschen
            </button>
          )}
        </>
      ) : (
        <button
          className="primary-btn"
          disabled={!name.trim()}
          onClick={() => {
            const newId = createList(name, draftStores);
            nav.replace({ kind: "list", id: newId });
            nav.toast({ text: `Liste „${name.trim()}“ angelegt` });
          }}
        >
          <Plus /> Liste anlegen
        </button>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function StorePage({ id, listId, nav }: { id: string | null; listId: string; nav: Nav }) {
  const s = useStore().snapshot;
  const st = id ? s.stores.get(id) : undefined;
  const used = new Set([...s.stores.values()].map((x) => x.color.toUpperCase()));
  const [name, setName] = useState(st?.name ?? "");
  const [color, setColor] = useState(st?.color ?? COLORS.find((c) => !used.has(c)) ?? COLORS[0]);

  useEffect(() => {
    if (id && !st) nav.back();
  });
  if (id && !st) return null;

  const pickColor = (c: string) => {
    setColor(c);
    if (st) updateStore(st.id, { color: c });
  };
  const route = st ? routeOf(s, st.id).map((cid) => s.categories.get(cid)).filter((c) => c !== undefined) : [];

  return (
    <>
      <NameField label="Name" value={name} onChange={setName} onCommit={() => st && name.trim() && name.trim() !== st.name && updateStore(st.id, { name: name.trim() })} />

      <div className="group">
        <span className="label">Farbe</span>
        <div className="swatches">
          {COLORS.map((c) => (
            <button key={c} className="swatch" style={dotStyle(c)} aria-pressed={color.toUpperCase() === c} aria-label={`Farbe ${c}`} onClick={() => pickColor(c)}>
              {color.toUpperCase() === c && <Check size={16} />}
            </button>
          ))}
        </div>
      </div>

      {st ? (
        <>
          <div className="group">
            <span className="label">Laufweg – so sortiert die App die Warengruppen</span>
            <div className="set-list">
              <SortableList items={route} getId={(c) => c.id} getLabel={(c) => c.name} onReorder={(ids) => setRoute(st.id, ids)}>
                {(c, handle) => (
                  <div className="set-row">
                    <span className="main"><strong>{c.name}</strong></span>
                    {handle}
                  </div>
                )}
              </SortableList>
            </div>
            <p className="hint">Am Griff ziehen. Die Reihenfolge der Artikel innerhalb einer Warengruppe änderst du in der Liste über ⋮ → „Reihenfolge ändern“.</p>
          </div>
          <button
            className="danger-btn"
            onClick={() => {
              if (!confirm(`Geschäft „${st.name}“ löschen? Es verschwindet aus allen Listen.`)) return;
              deleteStore(st.id);
              nav.back();
            }}
          >
            <Trash size={18} /> Geschäft löschen
          </button>
        </>
      ) : (
        <>
          <p className="hint">Das neue Geschäft kommt ans Ende der aktuellen Liste („{s.lists.get(listId)?.name}“). Die Priorität änderst du bei der Liste.</p>
          <button
            className="primary-btn"
            disabled={!name.trim()}
            onClick={() => {
              const newId = createStore(name, color, listId);
              nav.replace({ kind: "store", id: newId });
              nav.toast({ text: `${name.trim()} angelegt – jetzt den Laufweg sortieren` });
            }}
          >
            <Plus /> Geschäft anlegen
          </button>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function CategoryPage({ id, nav }: { id: string | null; nav: Nav }) {
  const s = useStore().snapshot;
  const cat = id ? s.categories.get(id) : undefined;
  const [name, setName] = useState(cat?.name ?? "");

  useEffect(() => {
    if (id && !cat) nav.back();
  });
  if (id && !cat) return null;

  const count = cat ? [...s.products.values()].filter((p) => p.categoryId === cat.id).length : 0;
  return (
    <>
      <NameField label="Name" value={name} onChange={setName} onCommit={() => cat && name.trim() && name.trim() !== cat.name && renameCategory(cat.id, name)} />
      {cat ? (
        <>
          <p className="hint">{count} {count === 1 ? "Artikel gehört" : "Artikel gehören"} zu dieser Warengruppe.</p>
          {s.categories.size > 1 && (
            <button
              className="danger-btn"
              onClick={() => {
                if (!confirm(`Warengruppe „${cat.name}“ löschen? Ihre Artikel kommen nach „Sonstiges“.`)) return;
                deleteCategory(cat.id);
                nav.back();
              }}
            >
              <Trash size={18} /> Warengruppe löschen
            </button>
          )}
        </>
      ) : (
        <>
          <p className="hint">Neue Warengruppen stehen in jedem Laufweg zunächst am Ende.</p>
          <button
            className="primary-btn"
            disabled={!name.trim()}
            onClick={() => {
              createCategory(name);
              nav.back();
              nav.toast({ text: `Warengruppe „${name.trim()}“ angelegt` });
            }}
          >
            <Plus /> Warengruppe anlegen
          </button>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function MembersPage({ nav, onInvite }: { nav: Nav; onInvite: () => void }) {
  const st = useStore();
  const myId = st.session?.memberId;
  const [myName, setMyName] = useState(st.session?.memberName ?? "");
  const [busy, setBusy] = useState(false);
  const members = [...st.snapshot.members.values()].filter((m) => !m.revoked).sort((a, b) => a.name.localeCompare(b.name, "de"));

  const run = async (fn: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await fn();
      nav.toast({ text: done });
    } catch (e) {
      nav.toast({ text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="set-list">
        {members.map((m) => (
          <div key={m.id} className="set-row">
            <span className="main">
              <strong>{m.name}</strong>
              {m.id === myId ? <small>dieses Gerät</small> : m.name === st.session?.memberName && <small>dein anderes Gerät</small>}
            </span>
            {m.id !== myId && (
              <button
                className="secondary-btn"
                style={{ minHeight: 40, padding: "0 12px", fontSize: 14 }}
                disabled={busy}
                onClick={() => confirm(`„${m.name}“ entfernen? Das Gerät ist danach abgemeldet.`) && void run(() => removeMember(m.id), `${m.name} entfernt`)}
              >
                Entfernen
              </button>
            )}
          </div>
        ))}
      </div>
      <p className="hint">
        Jedes Gerät zählt einzeln. Für ein weiteres Gerät (zweites Handy, Browser am PC) einfach einladen und denselben Namen eingeben – dann zeigt
        die App deine Häkchen nicht als „von …“ an. Alte Geräte hier entfernen.
      </p>

      <div className="group">
        <span className="label">Dein Name auf diesem Gerät</span>
        <div className="qty-row">
          <span className="field compact">
            <input value={myName} onChange={(e) => setMyName(e.target.value)} maxLength={40} aria-label="Dein Name" />
          </span>
          <button
            className="secondary-btn"
            style={{ minHeight: 44, padding: "0 14px" }}
            disabled={busy || !myName.trim() || myName.trim() === st.session?.memberName}
            onClick={() => void run(() => renameMe(myName.trim()), "Name gespeichert")}
          >
            Speichern
          </button>
        </div>
      </div>

      <button className="primary-btn" onClick={onInvite}><UserPlus /> Mitglied einladen</button>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function DataPage({ nav }: { nav: Nav }) {
  const [file, setFile] = useState<{ name: string; backup: Backup; skipped: number } | null>(null);
  const [mode, setMode] = useState<ImportMode>("merge");
  const [error, setError] = useState("");
  const counts = file ? countByTable(file.backup) : null;

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setError("");
    try {
      setFile({ name: f.name, ...parseBackup(JSON.parse(await f.text())) });
    } catch (err) {
      setFile(null);
      setError(err instanceof SyntaxError ? "Die Datei ist kein gültiges JSON." : errorText(err));
    }
  };

  const runImport = () => {
    if (!file) return;
    if (mode === "replace" && !confirm("Wirklich alles ersetzen? Was nicht in der Datei steht, wird auf allen Geräten gelöscht.")) return;
    const n = importBackup(file.backup, mode);
    nav.toast({ text: `Import übernommen (${n} Änderungen) – wird synchronisiert` });
    setFile(null);
  };

  return (
    <>
      <Section label="Sichern">
        <p className="hint">Alle Listen, Geschäfte, Warengruppen, Artikel und Einträge als JSON-Datei. Geräte und Mitglieder gehören nicht dazu.</p>
        <button className="secondary-btn" onClick={() => nav.toast({ text: `${exportBackup()} Datensätze exportiert` })}>
          <Download /> Alles exportieren
        </button>
      </Section>

      <Section label="Wiederherstellen">
        <label className="secondary-btn" style={{ cursor: "pointer" }}>
          <Import /> JSON-Datei auswählen
          <input type="file" accept=".json,application/json" className="sr" onChange={(e) => void onFile(e)} />
        </label>
        {error && <p className="error">{error}</p>}
        {file && counts && (
          <>
            <p className="hint">
              <strong>{file.name}</strong>
              {file.backup.household && ` · ${file.backup.household}`}
              {file.backup.exportedAt && ` · vom ${new Date(file.backup.exportedAt).toLocaleDateString("de-DE")}`}
              <br />
              {counts.store} Geschäfte, {counts.list} Listen, {counts.category} Warengruppen, {counts.product} Artikel, {counts.entry} Einträge
              {file.skipped > 0 && ` (${file.skipped} ungültige Angaben übersprungen)`}
            </p>
            <div className="seg" role="group" aria-label="Art des Imports">
              <button aria-pressed={mode === "merge"} onClick={() => setMode("merge")}>Zusammenführen</button>
              <button aria-pressed={mode === "replace"} onClick={() => setMode("replace")}>Alles ersetzen</button>
            </div>
            <p className="hint">
              {mode === "merge"
                ? "Datensätze aus der Datei überschreiben gleichnamige, alles andere bleibt erhalten."
                : "Danach entspricht der Haushalt genau der Datei – alles andere wird auf allen Geräten gelöscht. Tipp: vorher exportieren."}
            </p>
            <button className={mode === "replace" ? "danger-btn" : "primary-btn"} onClick={runImport}>
              <Import /> {mode === "replace" ? "Alles ersetzen" : "Zusammenführen"}
            </button>
          </>
        )}
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function ImportPage({ listId, nav }: { listId: string; nav: Nav }) {
  const s = useStore().snapshot;
  const [text, setText] = useState("");
  const [target, setTarget] = useState(listId);
  const count = text.split(/\r?\n/).map(parseImportLine).filter(Boolean).length;
  return (
    <>
      <p className="hint">
        Liste als Text kopieren (in Listonic z. B. über „Teilen“) und hier einfügen – eine Zeile pro Artikel. Mengen wie „2 Milch“ oder „Milch (1 l)“
        werden erkannt, bekannte Artikel behalten Warengruppe und Geschäfte.
      </p>
      <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder={"Milch\n2 Brot\nTomaten (500 g)"} aria-label="Liste als Text" />
      <div className="group">
        <span className="label">In Liste</span>
        <div className="chips">
          {sortedLists(s).map((l) => (
            <button key={l.id} className="chip" aria-pressed={l.id === target} onClick={() => setTarget(l.id)}>{l.name}</button>
          ))}
        </div>
      </div>
      <button
        className="primary-btn"
        disabled={!count}
        onClick={() => {
          const { added, updated } = importText(text, target);
          nav.toast({ text: `${added} Artikel übernommen${updated ? `, ${updated} standen schon drauf` : ""}` });
          nav.back();
        }}
      >
        <Import /> {count} {count === 1 ? "Artikel" : "Artikel"} übernehmen
      </button>
    </>
  );
}
