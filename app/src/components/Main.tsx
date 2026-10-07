import { badgeCount, defaultList, isExclusive, items, primaryGroups, shownAt, sortedLists, sortedStores, storeView, type DoneMode, type Item, type Mode } from "@shared/view.ts";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowRight, Cart, CheckCircle, ChevronDown, ChevronRight, CloudOff, CloudOk, CloudSync, DoneBelow, Download, Eye, EyeOff, More, Plus, Refresh, Route, Settings as SettingsIcon, UserPlus } from "../icons.tsx";
import { finishTrip, reorderProducts, toggleChecked } from "../lib/actions.ts";
import { ago, plural } from "../lib/format.ts";
import { setPrefs, usePrefs } from "../lib/prefs.ts";
import { usePwaUpdate } from "../lib/pwa.ts";
import { store, useStore } from "../lib/store.ts";
import { PULL_THRESHOLD, usePullToRefresh } from "../lib/usePullToRefresh.ts";
import { useWakeLock } from "../lib/useWakeLock.ts";
import { ItemRow } from "./ItemRow.tsx";
import { Settings, type SettingsPage } from "./Settings.tsx";
import { AddSheet, EditSheet, InviteSheet } from "./Sheets.tsx";
import { SortableList } from "./Sortable.tsx";

/** Der Knopf „Erledigte“ schaltet reihum: an ihrem Platz → unten gesammelt → ausgeblendet. */
const DONE_NEXT: Record<DoneMode, DoneMode> = { inline: "unten", unten: "aus", aus: "inline" };
const DONE_LABEL: Record<DoneMode, string> = { inline: "Erledigte an ihrem Platz", unten: "Erledigte unten gesammelt", aus: "Erledigte ausgeblendet" };

type Sheet = { kind: "add" } | { kind: "edit"; id: string } | { kind: "invite" } | null;
export interface Toast {
  text: string;
  undo?: () => void;
}

export function Main() {
  const st = useStore();
  const prefs = usePrefs();
  const s = st.snapshot;
  const [menu, setMenu] = useState<"list" | "more" | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [settings, setSettings] = useState<SettingsPage | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const contentRef = useRef<HTMLElement>(null);
  const { needRefresh, install } = usePwaUpdate();
  const all = useMemo(() => items(s), [s]);

  useWakeLock(prefs.shopping);
  useEffect(() => store.setFast(prefs.shopping), [prefs.shopping]);

  const showToast = (t: Toast) => {
    window.clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = window.setTimeout(() => setToast(null), 4500);
  };
  const onSyncNow = async () => {
    setMenu(null);
    const ok = await store.syncNow();
    showToast({
      text: ok ? "Synchronisiert" : store.status === "offline" ? "Offline – Änderungen bleiben gespeichert" : store.lastError || "Sync fehlgeschlagen",
    });
  };
  // Erst aktiv, wenn die Liste da ist (vorher gibt es kein Scroll-Element).
  const ptr = usePullToRefresh(contentRef, onSyncNow, s.lists.size > 0);

  const lists = sortedLists(s);
  const list = s.lists.get(prefs.listId) ?? defaultList(s);
  if (!list) {
    return (
      <div className="splash">
        {st.status === "offline" ? "Offline – noch keine Daten auf diesem Gerät." : "Daten werden geladen…"}
      </div>
    );
  }

  // Geschäfts-Tabs gelten für alle Listen; nur „Alle“ (Planung) zeigt die gewählte Liste.
  const stores = sortedStores(s);
  const tab = prefs.tab === "alle" || s.stores.has(prefs.tab) ? prefs.tab : (list.storeIds.find((id) => s.stores.has(id)) ?? stores[0]?.id ?? "alle");
  const storeId = tab === "alle" ? null : tab;
  const store_ = storeId ? s.stores.get(storeId) : undefined;
  const mode: Mode = (storeId && prefs.modes[storeId]) || "alles";
  const view = storeId ? storeView(s, all, { storeId, mode, done: prefs.done }) : null;
  const plan = storeId ? null : primaryGroups(s, all, list.id, prefs.done);
  // Umsortieren nur, wenn alles an seinem Platz steht – sonst fehlen Nachbarn und Lücken wären unsichtbar.
  const sortable = prefs.done === "inline";

  const me = st.session?.memberId;
  const myName = st.session?.memberName;
  /** „von Anna“ nur bei anderen Personen – eigene weitere Geräte (gleicher Name) zählen als „ich“. */
  const byName = (it: Item) => {
    if (!it.entry.checked || !it.entry.checkedBy || it.entry.checkedBy === me) return undefined;
    const name = s.members.get(it.entry.checkedBy)?.name;
    return name && name !== myName ? name : undefined;
  };
  const dotFor = (it: Item) => (storeId && mode === "alles" && !it.entry.checked && isExclusive(it, storeId) ? store_?.color : undefined);
  // Jedes Abhaken lässt sich rückgängig machen – ausgeblendete Erledigte verschwinden sonst einfach.
  const onToggle = (it: Item) => {
    const undo = toggleChecked(it.entry);
    showToast({ text: `${it.product.name} ${it.entry.checked ? "wieder offen" : "abgehakt"}`, undo });
  };
  const row = (it: Item, handle?: ReactNode) => (
    <ItemRow
      key={it.entry.id}
      item={it}
      dotColor={dotFor(it)}
      checkedBy={byName(it)}
      onToggle={onToggle}
      onEdit={(id) => setSheet({ kind: "edit", id })}
      handle={handle}
    />
  );

  const doneShown = all.filter((it) => it.entry.checked && (storeId ? shownAt(it, storeId, mode) : it.list.id === list.id)).length;
  const doneAll = all.filter((it) => it.entry.checked).length;
  const hasDots = !!view && view.groups.some((g) => g.items.some((it) => dotFor(it)));
  const isOpen = (key: string) => prefs.open[key] === true;
  const toggleOpen = (key: string) => setPrefs((p) => ({ open: { ...p.open, [key]: !p.open[key] } }));

  const closeMenuAnd = (fn: () => void) => () => {
    setMenu(null);
    fn();
  };
  const onDoneMode = () => {
    const next = DONE_NEXT[prefs.done];
    setPrefs({ done: next });
    showToast({ text: DONE_LABEL[next] });
  };
  const doneSection = (done: Item[]) =>
    done.length > 0 && (
      <section className="done-section">
        <h2 className="cat">
          <span>Erledigt</span>
          <span>{done.length}</span>
        </h2>
        {done.map((it) => row(it))}
      </section>
    );
  const onFinish = () => {
    const { count, undo } = finishTrip();
    showToast({ text: `${plural(count, "Eintrag", "Einträge")} abgeräumt`, undo });
  };

  return (
    <div className={prefs.shopping ? "app shopping" : "app"}>
      <header className="top">
        <div className="top-row">
          <button className="list-btn" onClick={() => setMenu(menu === "list" ? null : "list")} aria-haspopup="menu" aria-expanded={menu === "list"}>
            <span>{list.name}</span>
            <ChevronDown />
          </button>
          <div className="top-actions">
            <SyncChip onClick={onSyncNow} />
            <button className="icon-btn" onClick={() => setMenu(menu === "more" ? null : "more")} aria-label="Weitere Optionen" aria-expanded={menu === "more"}>
              <More size={22} />
              {needRefresh && <span className="dot-badge" />}
            </button>
          </div>
        </div>
        <nav className="tabs" aria-label="Geschäfte">
          {stores.map((st_) => {
            const n = badgeCount(all, st_.id);
            return (
              <button key={st_.id} className="tab" aria-pressed={tab === st_.id} style={{ "--c": st_.color } as CSSProperties} onClick={() => setPrefs({ tab: st_.id })}>
                {st_.name}
                {n > 0 && <span className="badge">{n}</span>}
              </button>
            );
          })}
          <button
            className="tab"
            aria-pressed={tab === "alle"}
            onClick={() => setPrefs({ tab: "alle" })}
          >
            Alle
          </button>
        </nav>
      </header>

      {st.sessionLost && (
        <div className="banner" role="alert">
          Dieses Gerät ist nicht mehr angemeldet.
          <button onClick={() => confirm("Gerät neu einrichten? Nicht synchronisierte Änderungen gehen verloren.") && void store.logout()}>Neu einrichten</button>
        </div>
      )}

      <div className="modebar">
        {prefs.shopping && (
          <div className="mode-bar">
            <Cart size={18} />
            <span>Einkaufsmodus – Display bleibt an</span>
            <button onClick={() => setPrefs({ shopping: false })}>Beenden</button>
          </div>
        )}
        <div className="modebar-row">
          {storeId ? (
            <div className="seg" role="group" aria-label="Ansicht">
              <button aria-pressed={mode === "alles"} onClick={() => setPrefs((p) => ({ modes: { ...p.modes, [storeId]: "alles" } }))}>
                Alles hier
              </button>
              <button aria-pressed={mode === "nur"} onClick={() => setPrefs((p) => ({ modes: { ...p.modes, [storeId]: "nur" } }))}>
                Nur für hier
              </button>
            </div>
          ) : (
            <span className="plan-hint">Nach Geschäft geplant</span>
          )}
          <button
            className="hide-btn"
            data-done={prefs.done}
            aria-label={`${DONE_LABEL[prefs.done]} – tippen zum Wechseln`}
            onClick={onDoneMode}
          >
            {prefs.done === "inline" ? <Eye size={18} /> : prefs.done === "unten" ? <DoneBelow size={18} /> : <EyeOff size={18} />}
            Erledigte
            {doneShown > 0 && <span className="count">{doneShown}</span>}
          </button>
        </div>
        {hasDots && (
          <span className="legend">
            <span className="dot" style={{ "--c": store_?.color } as CSSProperties} />
            Punkt = dafür musst du eigens herkommen
          </span>
        )}
      </div>

      <main className="content" ref={contentRef}>
        {(ptr.pull > 0 || ptr.refreshing) && (
          <div className={ptr.dragging ? "ptr dragging" : "ptr"} style={{ height: ptr.pull }} aria-live="polite">
            <span className={ptr.refreshing ? "ptr-icon spin" : "ptr-icon"} style={ptr.refreshing ? undefined : { transform: `rotate(${ptr.pull * 4}deg)` }}>
              <Refresh size={18} />
            </span>
            {ptr.refreshing ? "Synchronisiere…" : ptr.pull >= PULL_THRESHOLD ? "Loslassen zum Synchronisieren" : "Zum Synchronisieren ziehen"}
          </div>
        )}
        {view && storeId && (
          <>
            {view.groups.map((g) => (
              <section key={g.category.id}>
                <h2 className="cat">
                  <span>{g.category.name}</span>
                  <span>{g.open || "erledigt"}</span>
                </h2>
                {sortable ? (
                  <SortableList
                    items={g.items}
                    getId={(it) => it.product.id}
                    getLabel={(it) => it.product.name}
                    onReorder={(ids) => reorderProducts(storeId, g.category.id, ids)}
                  >
                    {(it, handle) => row(it, handle)}
                  </SortableList>
                ) : (
                  g.items.map((it) => row(it))
                )}
              </section>
            ))}
            {doneSection(view.done)}
            {view.groups.length === 0 && view.done.length === 0 && (
              <p className="empty">
                {all.length > 0
                  ? mode === "nur"
                    ? `Bei ${store_?.name} musst du nichts eigens kaufen.`
                    : `Nichts von den Listen gibt es bei ${store_?.name}.`
                  : "Die Listen sind leer – unten etwas hinzufügen."}
              </p>
            )}
            {view.notHere.length > 0 && (
              <section className="box">
                <button className="box-head" aria-expanded={isOpen("na")} onClick={() => toggleOpen("na")}>
                  <span className="chev"><ChevronRight size={18} /></span>
                  <span>Nicht hier erhältlich</span>
                  <span className="pill">{view.notHere.length}</span>
                </button>
                {isOpen("na") && (
                  <div className="box-body">
                    {view.notHere.map((it) => {
                      const target = it.primary ? s.stores.get(it.primary) : undefined;
                      return (
                        <button key={it.entry.id} className="row" onClick={() => target && setPrefs({ tab: target.id })}>
                          <span className="na-name">{it.product.name}</span>
                          {target && (
                            <span className="store-chip" style={{ "--c": target.color } as CSSProperties}>
                              {target.name}
                              <ArrowRight size={13} />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            )}
          </>
        )}
        {plan && (
          <>
            {plan.groups.map((g) => (
              <section key={g.store.id}>
                <div className="store-head" style={{ "--c": g.store.color } as CSSProperties}>
                  <span className="dot" />
                  <h2>
                    {g.store.name} <small>· {g.open} offen</small>
                  </h2>
                  <button className="go-btn" onClick={() => setPrefs({ tab: g.store.id })}>
                    Zum Laden <ArrowRight size={15} />
                  </button>
                </div>
                {g.items.map((it) => row(it))}
              </section>
            ))}
            {doneSection(plan.done)}
            {plan.groups.length === 0 && plan.done.length === 0 && <p className="empty">Die Liste ist leer – unten etwas hinzufügen.</p>}
          </>
        )}
      </main>

      <footer className="foot">
        <button className="add-btn" onClick={() => setSheet({ kind: "add" })}>
          <Plus size={22} />
          Artikel hinzufügen…
        </button>
      </footer>

      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              onClick={() => {
                toast.undo?.();
                setToast(null);
              }}
            >
              Rückgängig
            </button>
          )}
        </div>
      )}

      {menu && <button className="backdrop" aria-label="Menü schließen" onClick={() => setMenu(null)} />}
      {menu === "list" && (
        <div className="menu left" role="menu">
          {lists.map((l) => (
            <button
              key={l.id}
              className="menu-item"
              role="menuitemradio"
              aria-checked={l.id === list.id}
              aria-pressed={l.id === list.id}
              onClick={closeMenuAnd(() => setPrefs({ listId: l.id }))}
            >
              {l.name}
              <small>{all.filter((it) => it.list.id === l.id && !it.entry.checked).length} offen</small>
            </button>
          ))}
          <div className="menu-sep" />
          <button className="menu-item" role="menuitem" onClick={closeMenuAnd(() => setSettings({ kind: "list", id: list.id }))}>
            <SettingsIcon size={20} />
            Liste bearbeiten
          </button>
        </div>
      )}
      {menu === "more" && (
        <div className="menu right" role="menu">
          <button className="menu-item" role="menuitem" onClick={onSyncNow}>
            <Refresh size={20} />
            Jetzt synchronisieren
            <small>{ago(st.lastSyncAt)}</small>
          </button>
          <button className="menu-item" role="menuitemcheckbox" aria-checked={prefs.shopping} onClick={closeMenuAnd(() => setPrefs((p) => ({ shopping: !p.shopping })))}>
            <Cart size={20} />
            Einkaufsmodus
            {prefs.shopping && <span className="on">an</span>}
          </button>
          {doneAll > 0 && (
            <button className="menu-item" role="menuitem" onClick={closeMenuAnd(onFinish)}>
              <CheckCircle size={20} />
              Einkauf abschließen
              <small>{doneAll} erledigt</small>
            </button>
          )}
          {store_ && (
            <button className="menu-item" role="menuitem" onClick={closeMenuAnd(() => setSettings({ kind: "store", id: store_.id }))}>
              <Route size={20} />
              Laufweg {store_.name}
            </button>
          )}
          <button className="menu-item" role="menuitem" onClick={closeMenuAnd(() => setSheet({ kind: "invite" }))}>
            <UserPlus size={20} />
            Mitglied einladen
          </button>
          <button className="menu-item" role="menuitem" onClick={closeMenuAnd(() => setSettings({ kind: "root" }))}>
            <SettingsIcon size={20} />
            Einstellungen
          </button>
          {needRefresh && (
            <button className="menu-item" role="menuitem" onClick={install}>
              <Download size={20} />
              Update installieren
            </button>
          )}
          <div className="menu-sep" />
          <div className="menu-note">
            {st.session?.householdName} · angemeldet als {st.session?.memberName}
            {st.pending > 0 && <><br />{plural(st.pending, "Änderung wartet", "Änderungen warten")} auf Sync</>}
            {st.lastError && <><br />{st.lastError}</>}
          </div>
        </div>
      )}

      {sheet?.kind === "add" && <AddSheet listId={list.id} onClose={() => setSheet(null)} onToast={showToast} />}
      {sheet?.kind === "edit" && <EditSheet entryId={sheet.id} onClose={() => setSheet(null)} onToast={showToast} />}
      {sheet?.kind === "invite" && <InviteSheet onClose={() => setSheet(null)} />}
      {settings && <Settings start={settings} currentListId={list.id} onClose={() => setSettings(null)} onToast={showToast} />}
    </div>
  );
}

function SyncChip({ onClick }: { onClick: () => void }) {
  const st = useStore();
  let state: "ok" | "busy" | "offline" | "error";
  let label: string;
  let icon;
  if (st.status === "offline") {
    state = "offline";
    label = st.pending ? `Offline · ${st.pending}` : "Offline";
    icon = <CloudOff size={17} />;
  } else if (st.status === "error") {
    state = "error";
    label = "Fehler";
    icon = <CloudOff size={17} />;
  } else if (st.pending > 0) {
    // Online werden eigene Änderungen nach ~1,5 s hochgeladen – kurz „Sync…“ statt eines Zählers.
    state = "busy";
    label = "Sync…";
    icon = <CloudSync size={17} />;
  } else {
    // Ein Hintergrund-Abgleich ohne eigene Änderungen soll nicht flackern.
    state = "ok";
    label = "Synchron";
    icon = <CloudOk size={17} />;
  }
  return (
    <button className="sync-chip" data-state={state} onClick={onClick} aria-label={`${label}. Tippen: jetzt synchronisieren`}>
      {icon}
      {label}
    </button>
  );
}
