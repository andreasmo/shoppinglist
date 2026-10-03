import "@fontsource-variable/figtree";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./lib/pwa.ts";
import { store } from "./lib/store.ts";
import { initTheme } from "./lib/theme.ts";

initTheme();
void store.init();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
