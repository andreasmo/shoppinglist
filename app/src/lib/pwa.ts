// Service Worker gleich beim App-Start registrieren (auch auf dem Einrichtungsbildschirm),
// damit die App sofort offline verfügbar ist. Neue Versionen warten auf „Update installieren“
// bzw. den nächsten Start.
import { useSyncExternalStore } from "react";
import { registerSW } from "virtual:pwa-register";

const HOUR = 3600_000;
let needRefresh = false;
const listeners = new Set<() => void>();

const updateSW = registerSW({
  onNeedRefresh() {
    needRefresh = true;
    for (const fn of listeners) fn();
  },
  // Lange geöffnete App: stündlich nach einer neuen Version schauen.
  onRegisteredSW(_url, reg) {
    if (reg) setInterval(() => void reg.update(), HOUR);
  },
});

export function usePwaUpdate(): { needRefresh: boolean; install: () => void } {
  const value = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    () => needRefresh,
  );
  return { needRefresh: value, install: () => void updateSW(true) };
}
