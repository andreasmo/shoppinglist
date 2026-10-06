// Haushalte, Einladungen und Geräte-Tokens. In der DB liegen nur Hashes von Tokens und Codes.
import type { SessionInfo } from "../shared/model.ts";
import { seedRecords } from "../shared/seed.ts";
import type { Db, Stmt } from "./db/types.ts";
import { HttpError } from "./http.ts";
import { upsertField } from "./sync.ts";

export interface AuthedMember {
  memberId: string;
  memberName: string;
  householdId: string;
  householdName: string;
}

const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomCode(length = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => INVITE_ALPHABET[b % INVITE_ALPHABET.length]).join("");
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function cleanName(value: unknown, what: string): string {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 40) throw new HttpError(400, `${what}: 1 bis 40 Zeichen`);
  return name;
}

export async function createHousehold(db: Db, householdName: string, memberName: string): Promise<SessionInfo> {
  const householdId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const token = randomToken();
  const now = Date.now();

  // Neuer Haushalt: revs können direkt vergeben werden, es schreibt noch niemand sonst.
  const records = [...seedRecords(), { tbl: "member" as const, rid: memberId, fields: { name: memberName } }];
  const fieldStmts: Stmt[] = [];
  let rev = 0;
  for (const r of records) {
    for (const [field, value] of Object.entries(r.fields)) {
      rev++;
      fieldStmts.push({
        sql: "INSERT INTO fields (household_id, tbl, rid, field, value, ts, mid, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        args: [householdId, r.tbl, r.rid, field, JSON.stringify(value), r.tbl === "member" ? now : 1, "seed", rev],
      });
    }
  }
  await db.batch([
    {
      sql: "INSERT INTO households (id, name, rev, created_at) VALUES (?, ?, ?, ?)",
      args: [householdId, householdName, rev, now],
    },
    {
      sql: "INSERT INTO members (id, household_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)",
      args: [memberId, householdId, memberName, await sha256(token), now],
    },
    ...fieldStmts,
  ]);
  return { token, memberId, memberName, householdId, householdName };
}

export async function createInvite(db: Db, member: AuthedMember): Promise<{ code: string; expiresAt: number }> {
  const code = randomCode();
  const expiresAt = Date.now() + INVITE_TTL_MS;
  const created = await db.execute(
    `INSERT INTO invites (code_hash, household_id, created_by, expires_at)
    SELECT ?, household_id, id, ? FROM members WHERE id = ? AND household_id = ? AND revoked_at IS NULL
    RETURNING code_hash`,
    [
      await sha256(code),
      expiresAt,
      member.memberId,
      member.householdId,
    ],
  );
  if (!created.length) throw new HttpError(401, "Gerät ist nicht (mehr) angemeldet");
  return { code, expiresAt };
}

export async function joinHousehold(db: Db, code: string, memberName: string): Promise<SessionInfo> {
  const memberId = crypto.randomUUID();
  const token = randomToken();
  const tokenHash = await sha256(token);
  const codeHash = await sha256(normalizeCode(code));
  const now = Date.now();
  // Einladung erst in der Schreib-Transaktion prüfen. Ein gleichzeitiges Entfernen
  // darf keine zuvor gelesene, inzwischen widerrufene Einladung durchlassen.
  const results = await db.batch([
    {
      sql: `INSERT INTO members (id, household_id, name, token_hash, created_at)
        SELECT ?, i.household_id, ?, ?, ? FROM invites i
        JOIN members creator ON creator.id = i.created_by AND creator.household_id = i.household_id
        WHERE i.code_hash = ? AND i.expires_at > ? AND creator.revoked_at IS NULL`,
      args: [memberId, memberName, tokenHash, now, codeHash, now],
    },
    {
      sql: "UPDATE households SET rev = rev + 1 WHERE id = (SELECT household_id FROM members WHERE id = ?)",
      args: [memberId],
    },
    {
      sql: `INSERT INTO fields (household_id, tbl, rid, field, value, ts, mid, rev)
        SELECT m.household_id, 'member', m.id, 'name', ?, ?, 'server', h.rev
        FROM members m JOIN households h ON h.id = m.household_id WHERE m.id = ?`,
      args: [JSON.stringify(memberName), now, memberId],
    },
    {
      sql: "SELECT h.id, h.name FROM members m JOIN households h ON h.id = m.household_id WHERE m.id = ?",
      args: [memberId],
    },
  ]);
  const rows = results[results.length - 1];
  if (!rows.length) throw new HttpError(404, "Einladung unbekannt oder abgelaufen");
  const householdId = String(rows[0].id);
  const householdName = String(rows[0].name);
  return { token, memberId, memberName, householdId, householdName };
}

export async function renameMember(db: Db, me: AuthedMember, name: string): Promise<void> {
  await db.batch([
    { sql: "UPDATE members SET name = ? WHERE id = ?", args: [name, me.memberId] },
    ...upsertField(me.householdId, "member", me.memberId, "name", name, Date.now(), "server"),
  ]);
}

/** Meldet ein Gerät des eigenen Haushalts ab (auch das eigene). Sein Token gilt danach nicht mehr. */
export async function revokeMember(db: Db, me: AuthedMember, memberId: string): Promise<void> {
  const rows = await db.execute("SELECT id FROM members WHERE id = ? AND household_id = ? AND revoked_at IS NULL", [
    memberId,
    me.householdId,
  ]);
  if (!rows.length) throw new HttpError(404, "Gerät nicht gefunden");
  const now = Date.now();
  await db.batch([
    { sql: "UPDATE members SET revoked_at = ? WHERE id = ?", args: [now, memberId] },
    // Auch der ursprüngliche Beitrittslink könnte auf dem entfernten Gerät liegen.
    { sql: "DELETE FROM invites WHERE household_id = ?", args: [me.householdId] },
    ...upsertField(me.householdId, "member", memberId, "revoked", true, now, "server"),
  ]);
}

export async function authenticate(db: Db, authorization: string | undefined): Promise<AuthedMember> {
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) throw new HttpError(401, "Nicht angemeldet");
  const rows = await db.execute(
    `SELECT m.id, m.name, h.id AS hid, h.name AS hname FROM members m JOIN households h ON h.id = m.household_id
     WHERE m.token_hash = ? AND m.revoked_at IS NULL`,
    [await sha256(token)],
  );
  if (!rows.length) throw new HttpError(401, "Gerät ist nicht (mehr) angemeldet");
  const r = rows[0];
  return { memberId: String(r.id), memberName: String(r.name), householdId: String(r.hid), householdName: String(r.hname) };
}
