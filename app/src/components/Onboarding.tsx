import { useEffect, useState, type FormEvent } from "react";
import { api, OfflineError } from "../lib/api.ts";
import { store } from "../lib/store.ts";

/**
 * Erste Einrichtung: per Einladung beitreten (Link: /#join=CODE) oder – mit dem Einrichtungscode
 * des Servers – einen neuen Haushalt anlegen.
 */
export function Onboarding() {
  const joinCode = new URLSearchParams(location.hash.slice(1)).get("join") ?? "";
  const [mode, setMode] = useState<"start" | "create" | "join">(joinCode ? "join" : "start");
  const [name, setName] = useState("");
  const [household, setHousehold] = useState("Familie");
  const [code, setCode] = useState(joinCode);
  const [setupCode, setSetupCode] = useState("");
  const [setupRequired, setSetupRequired] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.health().then((h) => setSetupRequired(h.setupCodeRequired), () => {});
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const session = mode === "create"
        ? await api.createHousehold(household.trim(), name.trim(), setupCode.trim())
        : await api.join(code.trim(), name.trim());
      history.replaceState(null, "", location.pathname);
      await store.startSession(session);
    } catch (err) {
      setError(err instanceof OfflineError ? "Keine Verbindung – bitte online erneut versuchen." : err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="onb">
      <img className="onb-logo" src="/pwa-192.png" alt="" />
      <h1>Einkaufsliste</h1>
      {mode === "start" && (
        <>
          <p className="hint">
            Eine gemeinsame Liste für die Familie – funktioniert auch ohne Netz im Laden. Zum Mitmachen brauchst du eine Einladung von
            jemandem aus deinem Haushalt.
          </p>
          <button className="primary-btn" onClick={() => setMode("join")}>Mit Einladung beitreten</button>
          <button className="secondary-btn" onClick={() => setMode("create")}>Neuen Haushalt anlegen</button>
        </>
      )}
      {mode !== "start" && (
        <form onSubmit={submit}>
          {mode === "create" ? (
            <>
              {setupRequired && (
                <label className="field-label">
                  <span className="label">Einrichtungscode</span>
                  <span className="field">
                    <input value={setupCode} onChange={(e) => setSetupCode(e.target.value)} autoCapitalize="characters" autoComplete="off" required />
                  </span>
                </label>
              )}
              <label className="field-label">
                <span className="label">Haushalt</span>
                <span className="field">
                  <input value={household} onChange={(e) => setHousehold(e.target.value)} maxLength={40} required />
                </span>
              </label>
            </>
          ) : (
            <label className="field-label">
              <span className="label">Einladungscode</span>
              <span className="field">
                <input value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" autoComplete="off" required />
              </span>
            </label>
          )}
          <label className="field-label">
            <span className="label">Dein Name</span>
            <span className="field">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="given-name" required />
            </span>
          </label>
          {mode === "create" && setupRequired && (
            <p className="hint">Den Einrichtungscode hat, wer die App aufgesetzt hat. Alle anderen treten per Einladung bei.</p>
          )}
          {error && <p className="error">{error}</p>}
          <button className="primary-btn" type="submit" disabled={busy}>
            {busy ? "Einen Moment…" : mode === "create" ? "Haushalt anlegen" : "Beitreten"}
          </button>
          {!joinCode && (
            <button type="button" className="back" onClick={() => setMode("start")}>
              ← Zurück
            </button>
          )}
        </form>
      )}
    </div>
  );
}
