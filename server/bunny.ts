// Einstieg für Bunny Edge Scripting (standalone). Gebündelt von deploy/build-api.ts.
import * as BunnySDK from "https://esm.sh/@bunny.net/edgescript-sdk@0.12.0";
import { createApp } from "./app.ts";
import { libsqlDb } from "./db/libsql.ts";

const env = (key: string) => Deno.env.get(key) ?? "";

const app = createApp({
  db: libsqlDb(env("BUNNY_DATABASE_URL"), env("BUNNY_DATABASE_AUTH_TOKEN")),
  allowedOrigins: env("ALLOWED_ORIGINS").split(",").map((s) => s.trim()).filter(Boolean),
  // Ohne gesetztes Secret ist das Anlegen neuer Haushalte gesperrt (Beitreten per Einladung geht immer).
  setupCode: env("SETUP_CODE"),
});

BunnySDK.net.http.serve((req: Request) => app.fetch(req));
