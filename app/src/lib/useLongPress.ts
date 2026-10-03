import { useRef, type MouseEvent, type PointerEvent } from "react";

/**
 * Tippen und langes Drücken auf demselben Element. Bewegt sich der Finger (Scrollen), zählt es
 * als keines von beidem. Das Kontextmenü (Rechtsklick, Android-Long-Press) öffnet ebenfalls.
 */
export function useLongPress(onLongPress: () => void, onTap: () => void, delayMs = 450) {
  const timer = useRef<number | undefined>(undefined);
  const fired = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);

  const cancel = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  };
  const fire = () => {
    cancel();
    if (fired.current) return;
    fired.current = true;
    try {
      navigator.vibrate?.(20);
    } catch {
      // nicht unterstützt
    }
    onLongPress();
  };

  return {
    onPointerDown(e: PointerEvent) {
      if (e.button !== 0) return;
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      cancel();
      timer.current = window.setTimeout(fire, delayMs);
    },
    onPointerMove(e: PointerEvent) {
      if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onClick(e: MouseEvent) {
      if (fired.current) {
        e.preventDefault();
        return;
      }
      onTap();
    },
    onContextMenu(e: MouseEvent) {
      e.preventDefault();
      fire();
    },
  };
}
