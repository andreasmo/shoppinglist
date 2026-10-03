import { useEffect, useRef, useState, type RefObject } from "react";

/** Ab dieser Zugweite (px) löst Loslassen die Aktualisierung aus. */
export const PULL_THRESHOLD = 64;
const MAX_PULL = 96;

/**
 * Runterziehen am Listenanfang (Touch). Liefert die aktuelle Zugweite für die Anzeige,
 * ob gerade gezogen wird und ob die Aktualisierung läuft.
 */
export function usePullToRefresh(ref: RefObject<HTMLElement | null>, onRefresh: () => Promise<unknown>, enabled: boolean) {
  const [pull, setPull] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let startY: number | null = null;
    let current = 0;

    const onStart = (e: TouchEvent) => {
      startY = el.scrollTop <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null;
    };
    const onMove = (e: TouchEvent) => {
      if (startY === null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0 || el.scrollTop > 0) {
        if (current) setPull((current = 0));
        return;
      }
      setDragging(true);
      current = Math.min(MAX_PULL, dy * 0.5); // gedämpft, fühlt sich „schwerer“ an
      setPull(current);
    };
    const onEnd = () => {
      if (startY === null) return;
      startY = null;
      setDragging(false);
      if (current >= PULL_THRESHOLD) {
        setRefreshing(true);
        setPull(PULL_THRESHOLD);
        void refresh.current().finally(() => {
          setRefreshing(false);
          setPull(0);
        });
      } else {
        setPull(0);
      }
      current = 0;
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [ref, enabled]);

  return { pull, dragging, refreshing };
}
