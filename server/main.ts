// Lokaler Server (Entwicklung, VM/Docker): SQLite-Datei, Migrationen, API und – falls gebaut – die PWA.
//   deno task dev
import { serveStatic } from "@hono/hono/deno";
import { dirname } from "@std/path";
import { createApp } from "./app.ts";
import { migrate } from "./migrate.ts";
import { sqliteDb } from "./db/sqlite.ts";

const dbPath = Deno.env.get("DB_PATH") ?? "server/data/dev.db";
await Deno.mkdir(dirname(dbPath), { recursive: true });

const db = sqliteDb(dbPath);
const applied = await migrate(db, new URL("./migrations/", import.meta.url));
if (applied.length) console.log(`Migrationen angewendet: ${applied.join(", ")}`);

const app = createApp({
  db,
  allowedOrigins: (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  // Lokal ohne SETUP_CODE: keine Prüfung. Mit SETUP_CODE (z. B. im Docker-Betrieb): Code nötig.
  setupCode: Deno.env.get("SETUP_CODE"),
});

// Gebaute PWA ausliefern (app/dist), Single-Page-Fallback auf index.html.
app.use("/*", serveStatic({ root: "./app/dist" }));
app.get("/*", serveStatic({ path: "./app/dist/index.html" }));

Deno.serve({ port: Number(Deno.env.get("PORT") ?? 8787) }, app.fetch);
