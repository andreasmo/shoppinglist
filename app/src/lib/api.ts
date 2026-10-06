import type { SessionInfo, SyncRequest, SyncResponse } from "@shared/model.ts";
import { exchangeSync } from "@shared/syncTransport.ts";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Keine Verbindung (offline, Zeitüberschreitung, DNS …). */
export class OfflineError extends Error {}

async function call<T>(path: string, opts: { body?: unknown; token?: string; timeoutMs?: number } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000);
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method: opts.body === undefined ? "GET" : "POST",
      headers: {
        ...(opts.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: ctrl.signal,
    });
  } catch {
    throw new OfflineError("Keine Verbindung");
  } finally {
    clearTimeout(timer);
  }
  // Gateway/Server vorübergehend nicht erreichbar: wie offline behandeln und später erneut versuchen.
  if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) throw new OfflineError(`Server vorübergehend nicht erreichbar (${res.status})`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Fehler ${res.status}`);
  return data as T;
}

export const api = {
  health: () => call<{ ok: boolean; setupCodeRequired: boolean }>("/api/health", { timeoutMs: 8_000 }),
  createHousehold: (householdName: string, memberName: string, setupCode: string) =>
    call<SessionInfo>("/api/households", { body: { householdName, memberName, setupCode } }),
  join: (code: string, memberName: string) => call<SessionInfo>("/api/join", { body: { code, memberName } }),
  invite: (token: string) => call<{ code: string; expiresAt: number }>("/api/invites", { body: {}, token }),
  rename: (token: string, name: string) => call<{ ok: boolean; name: string }>("/api/me", { body: { name }, token }),
  revoke: (token: string, memberId: string) =>
    call<{ ok: boolean }>(`/api/members/${encodeURIComponent(memberId)}/revoke`, { body: {}, token }),
  sync: (token: string, req: SyncRequest) =>
    exchangeSync(req, (packet) => call<SyncResponse>("/api/sync", { body: packet, token, timeoutMs: 25_000 })),
};
