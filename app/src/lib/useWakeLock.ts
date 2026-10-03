import { useEffect } from "react";

/** Hält das Display an, solange `active` – auch nach Zurückkehren in die App (Lock fällt beim Verlassen weg). */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
      } catch {
        // z. B. Energiesparmodus – dann eben nicht
      }
    };
    const onVisible = () => {
      if (!stopped && document.visibilityState === "visible") void acquire();
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, [active]);
}
