// Einstellungen pro Gerät (gewählte Liste, Tab, Ansichtsmodus …). Bewusst nicht synchronisiert.
import type { DoneMode, Mode } from "@shared/view.ts";
import { useSyncExternalStore } from "react";

export type Theme = "auto" | "light" | "dark";

export interface Prefs {
  theme: Theme;
  /** Einkaufsmodus: Display bleibt an, größere Zeilen, schnellerer Abgleich. */
  shopping: boolean;
  listId: string;
  /** Store-ID oder "alle". */
  tab: string;
  modes: Record<string, Mode>;
  /** Erledigte an ihrem Platz, gesammelt unten oder ausgeblendet. */
  done: DoneMode;
  /** Auf-/zugeklappte Bereiche („Aus Drogerie“, „Nicht hier erhältlich“). */
  open: Record<string, boolean>;
}

const KEY = "einkauf.prefs";
const DEFAULTS: Prefs = { theme: "auto", shopping: false, listId: "", tab: "", modes: {}, done: "inline", open: {} };

function load(): Prefs {
  try {
    const { hideDone, ...stored } = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    // Früher nur ein/aus – ausgeblendet bleibt ausgeblendet.
    return { ...DEFAULTS, ...(hideDone ? { done: "aus" } : {}), ...stored };
  } catch {
    return { ...DEFAULTS };
  }
}

let prefs = load();
const listeners = new Set<() => void>();

/** Teil-Update; als Funktion immer auf dem aktuellsten Stand (schnelle Doppelklicks). */
export function setPrefs(patch: Partial<Prefs> | ((p: Prefs) => Partial<Prefs>)) {
  prefs = { ...prefs, ...(typeof patch === "function" ? patch(prefs) : patch) };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // privater Modus o. Ä. – dann eben nur für diese Sitzung
  }
  for (const fn of listeners) fn();
}

export function getPrefs(): Prefs {
  return prefs;
}

export function onPrefsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    () => prefs,
  );
}
