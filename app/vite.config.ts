import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  resolve: {
    alias: { "@shared": fileURLToPath(new URL("../shared", import.meta.url)) },
  },
  server: {
    port: 5180,
    strictPort: true,
    fs: { allow: [".."] },
    // Lokal läuft die API unter `deno task dev` auf Port 8787.
    proxy: { "/api": "http://localhost:8787" },
  },
  plugins: [
    react(),
    VitePWA({
      // „prompt“: Eine neue Version wartet, bis die App das nächste Mal startet – nie mitten im Einkauf.
      registerType: "prompt",
      // Eigener Service Worker (src/sw.ts): Precache + Background Sync der Outbox.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
      },
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Einkaufsliste",
        short_name: "Einkauf",
        description: "Gemeinsame Einkaufsliste der Familie",
        lang: "de",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#FFFFFF",
        theme_color: "#FFFFFF",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
});
