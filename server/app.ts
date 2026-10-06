// HTTP-API (Hono). Ein Standard-fetch-Handler: läuft unter Deno.serve und im Bunny Edge Script.
import { Hono } from "@hono/hono";
import { cors } from "@hono/hono/cors";
import { createMiddleware } from "@hono/hono/factory";
import {
  type AuthedMember,
  authenticate,
  cleanName,
  createHousehold,
  createInvite,
  joinHousehold,
  normalizeCode,
  renameMember,
  revokeMember,
  sha256,
} from "./auth.ts";
import type { Db } from "./db/types.ts";
import { HttpError } from "./http.ts";
import { parseSyncRequest, sync } from "./sync.ts";

type Env = { Variables: { member: AuthedMember } };

export interface AppOptions {
  db: Db;
  /** Origins der PWA, die die API aufrufen dürfen (z. B. https://einkauf.example.com). */
  allowedOrigins: string[];
  /**
   * Einrichtungscode für „Neuen Haushalt anlegen“ (Secret SETUP_CODE).
   * undefined = keine Prüfung (nur lokale Entwicklung), "" = Anlegen gesperrt.
   */
  setupCode?: string;
}

export const MAX_BODY_BYTES = 512_000;

async function jsonBody(req: Request): Promise<Record<string, unknown>> {
  const tooLarge = () => new HttpError(413, "Anfrage zu groß");
  const length = req.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > MAX_BODY_BYTES) {
    void req.body?.cancel().catch(() => {});
    throw tooLarge();
  }
  const parts: string[] = [];
  const reader = req.body?.getReader();
  if (reader) {
    const decoder = new TextDecoder();
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BODY_BYTES) {
          void reader.cancel().catch(() => {});
          throw tooLarge();
        }
        parts.push(decoder.decode(value, { stream: true }));
      }
      parts.push(decoder.decode());
    } finally {
      reader.releaseLock();
    }
  }
  const text = parts.join("");
  try {
    const body = JSON.parse(text || "{}");
    if (body && typeof body === "object" && !Array.isArray(body)) return body;
  } catch {
    // fällt unten durch
  }
  throw new HttpError(400, "JSON erwartet");
}

export function createApp({ db, allowedOrigins, setupCode }: AppOptions) {
  const app = new Hono<Env>();
  const setupHash = setupCode ? sha256(normalizeCode(setupCode)) : null;

  app.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    c.header("Referrer-Policy", "no-referrer");
    if (new URL(c.req.url).protocol === "https:") c.header("Strict-Transport-Security", "max-age=31536000");
    await next();
  });

  const checkSetupCode = async (given: unknown) => {
    if (setupCode === undefined) return;
    if (!setupHash) throw new HttpError(403, "Neue Haushalte anlegen ist auf diesem Server gesperrt");
    if (typeof given !== "string" || (await sha256(normalizeCode(given))) !== (await setupHash)) {
      throw new HttpError(403, "Einrichtungscode stimmt nicht");
    }
  };

  app.use(
    "/api/*",
    cors({
      origin: allowedOrigins,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Authorization", "Content-Type"],
      maxAge: 7200,
    }),
  );

  const auth = createMiddleware<Env>(async (c, next) => {
    c.set("member", await authenticate(db, c.req.header("Authorization")));
    await next();
  });

  app.get("/api/health", (c) => c.json({ ok: true, setupCodeRequired: setupCode !== undefined }));

  app.post("/api/households", async (c) => {
    const body = await jsonBody(c.req.raw);
    await checkSetupCode(body.setupCode);
    const session = await createHousehold(
      db,
      cleanName(body.householdName ?? "Zuhause", "Haushalt"),
      cleanName(body.memberName, "Name"),
    );
    return c.json(session, 201);
  });

  app.post("/api/join", async (c) => {
    const body = await jsonBody(c.req.raw);
    if (typeof body.code !== "string") throw new HttpError(400, "Einladungscode fehlt");
    return c.json(await joinHousehold(db, body.code, cleanName(body.memberName, "Name")), 201);
  });

  app.get("/api/me", auth, (c) => c.json(c.get("member")));

  app.post("/api/me", auth, async (c) => {
    const name = cleanName((await jsonBody(c.req.raw)).name, "Name");
    await renameMember(db, c.get("member"), name);
    return c.json({ ok: true, name });
  });

  app.post("/api/members/:id/revoke", auth, async (c) => {
    await revokeMember(db, c.get("member"), c.req.param("id"));
    return c.json({ ok: true });
  });

  app.post("/api/invites", auth, async (c) => c.json(await createInvite(db, c.get("member")), 201));

  app.post("/api/sync", auth, async (c) => {
    const req = parseSyncRequest(await jsonBody(c.req.raw));
    return c.json(await sync(db, c.get("member").householdId, req));
  });

  app.notFound((c) => c.json({ error: "Nicht gefunden" }, 404));

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: "Interner Fehler" }, 500);
  });

  return app;
}
