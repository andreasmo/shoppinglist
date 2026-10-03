// Hell/Dunkel: „auto“ folgt dem System, sonst fest. Die Farben stehen als Variablen in styles.css.
import { getPrefs, onPrefsChange, type Theme } from "./prefs.ts";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === "auto") delete root.dataset.theme;
  else root.dataset.theme = theme;
  const dark = theme === "dark" || (theme === "auto" && matchMedia(DARK_QUERY).matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#111315" : "#FFFFFF");
}

export function initTheme() {
  apply(getPrefs().theme);
  onPrefsChange(() => apply(getPrefs().theme));
  matchMedia(DARK_QUERY).addEventListener("change", () => apply(getPrefs().theme));
}
