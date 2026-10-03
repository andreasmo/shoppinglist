# Familien-Einkaufsliste – Spec v0.3 (Diskussionsgrundlage)

Stand: 2026-10-03

## 0. Getroffene Entscheidungen

| # | Entscheidung |
|---|---|
| E1 | **PWA**, mobile-first (alle in der Familie nutzen Android), am PC ebenfalls nutzbar |
| E2 | **Backend in Deno**. Betrieb auf **Bunny**: Sites (PWA), Edge Script (API), Bunny Database. Deploy über die **Bunny CLI**. VM/Docker bleibt als Option möglich |
| E3 | **Mehrere Listen**, *Lebensmittel* ist die Standardliste |
| E4 | Store-Ansicht **umschaltbar**: „Alles hier“ ↔ „Nur für hier“ |
| E5 | **Listenübergreifende Store-Ansicht** gehört ins MVP |
| E6 | **Höchste Priorität:** übersichtliche, ansprechende Mobile-Ansicht und volle Offline-Fähigkeit |
| E7 | **Domain:** App unter `einkauf.example.com`, API unter `api.einkauf.example.com` |
| E8 | **UI-Richtung:** Prototyp A („Ruhig“) mit kompakten Zeilen; der Schalter „Erledigte“ sitzt direkt neben dem Ansichtsumschalter |
| E9 | **Sync alle 300 s** (im Einkaufsmodus alle 30 s), solange die App sichtbar ist, und sofort beim Öffnen. Eigene Änderungen gehen nach 1,5 s raus. Dazu kommen **Runterziehen zum Synchronisieren** und „Jetzt synchronisieren“ im ⋮-Menü |
| E10 | **Long-Press auf einen Eintrag** öffnet ein Bearbeiten-Menü (Menge, Notiz, Gibt’s bei, Warengruppe, Liste, entfernen) |
| E11 | **Zugang:** Neue Haushalte nur mit dem Einrichtungscode (Secret `SETUP_CODE`). Alle anderen treten per Einladungslink bei. Mehrere Haushalte sind möglich und voneinander getrennt |
| E12 | **Darstellung:** Automatisch (folgt dem System), Hell oder Dunkel – pro Gerät in den Einstellungen |
| E13 | **Menge im Bearbeiten-Menü:** Schnellwahl 1–5 plus Feld für andere Mengen (z. B. „500 g“) |
| E14 | **Sicherung:** Export aller Daten als JSON, Import wahlweise „Zusammenführen“ oder „Alles ersetzen“ (Format in Abschnitt 6.1) |
| E15 | **Mehrere Geräte einer Person:** einladen, dann denselben Namen eingeben. Häkchen von Geräten mit dem eigenen Namen erscheinen nicht als „von …“ |

---

## 1. Ausgangslage & Ziele

Heute (Listonic): eine Liste je Geschäft (Aldi, dm, Kaufland). Aldi ist der Standard, Kaufland nur für das, was Aldi nicht hat.

**Schmerzpunkte**
- Ein Artikel „gehört“ nicht zu einem Geschäft, sondern ist irgendwo *erhältlich*. Mit getrennten Listen muss man bei jedem Eintrag entscheiden, wohin er kommt, und Artikel landen in der falschen Liste.
- Die Sortierung springt: abgehakte Artikel rutschen nach unten, beim Zurückholen landen sie woanders.

**Ziele**
1. **Mobile zuerst:** übersichtlich, einhändig bedienbar, schnell.
2. **Offline zuerst:** im Laden funktioniert alles ohne Netz.
3. Geschäfte sind *Ansichten* auf die Listen, keine eigenen Listen.
4. **Stabile Sortierung** pro Geschäft (Laufweg). Abhaken ändert nie die Position.
5. **Live-Sync** in der Familie.
6. **Schnelles Hinzufügen** mit Autocomplete aus dem Verlauf.

**Vorerst nicht:** Preise, Rezepte, Prospekte/Angebote, iOS.

---

## 2. Kernkonzept

### 2.1 Listen
- Ein Haushalt hat mehrere Listen. Jede Liste hat ihre **Geschäfte in Prioritäts-Reihenfolge**.
- **Testkonfiguration (Seed):**
  - **Lebensmittel** (Standard): Aldi → Kaufland → dm
  - **Drogerie**: dm → Kaufland
- Geschäfte gibt es nur einmal pro Haushalt. Kaufland kommt in beiden Listen vor, sein Laufweg wird trotzdem nur einmal gepflegt.
- Jeder Artikel hat eine **Heimat-Liste** (Milch → Lebensmittel) und lässt sich verschieben.

### 2.2 Verfügbarkeit statt Store-Listen („Tagging“)
- Jeder Artikel im Katalog hat **„gibt's bei“**, z. B. Milch `{Aldi, Kaufland}`, Sumach `{Kaufland}`. Das pflegt man einmal, und es gilt für jeden weiteren Einkauf.
- **Primäres Geschäft eines Eintrags** = das erste Geschäft in der Prioritäts-Reihenfolge *seiner* Liste, das den Artikel führt. Pro Eintrag lässt sich das überschreiben („nur bei dm kaufen“).
- Abgehakt ist abgehakt, egal in welchem Laden. Es gibt nur einen Eintrag.
- Ein neuer Artikel bekommt als Verfügbarkeit standardmäßig das erste Geschäft der Liste. Das lässt sich per Chip ändern.

### 2.3 Ansichtsmodus je Geschäft (umschaltbar)
- **„Alles hier“**: alle offenen Einträge, die es in diesem Geschäft gibt. Die Einträge, für die man *eigens* herkommt, tragen einen Punkt in der Farbe des Geschäfts.
- **„Nur für hier“**: nur Einträge, deren primäres Geschäft dieses ist.
- Die letzte Wahl merkt sich die App pro Geschäft und Gerät.

### 2.4 Listenübergreifend
- In der Ansicht eines Geschäfts stehen unten die offenen Einträge **anderer Listen**, die es dort gibt. Sie sind eingeklappt und je Liste gruppiert, z. B. bei Kaufland in „Lebensmittel“ die Gruppe „Aus Drogerie (2)“. Innerhalb der Gruppe gilt der Laufweg.
- Der Ansichtsmodus gilt auch dort.
- **Tab-Badges** zählen über alle Listen, wie viele Einträge man *eigens* in diesem Geschäft kaufen muss. Daran sieht man auf einen Blick, ob sich der Weg zu dm oder Kaufland lohnt.

---

## 3. Sortierung

- Die Position ist eine Eigenschaft von **(Geschäft × Artikel)**, nicht vom Listeneintrag. Sie bleibt deshalb über alle Einkäufe hinweg erhalten.
- **Zweistufig:**
  1. Warengruppen in Laufweg-Reihenfolge je Geschäft.
  2. Innerhalb einer Warengruppe manuell per Drag & Drop.
- **Abgehakt bleibt an Ort und Stelle** (grau, durchgestrichen). „Erledigte ausblenden“ blendet nur aus und sortiert nichts um.
- **„Einkauf abschließen“** räumt die abgehakten Einträge ab, die Artikel bleiben im Katalog.
- Technik: Fractional Indexing (String-Positionen). Umsortieren ändert nur eine einzige Zeile.
- Später: den Laufweg **lernen** aus der Reihenfolge, in der im Laden abgehakt wird.

---

## 4. Mobile-UX (höchste Priorität)

### 4.1 Leitlinien
- **Daumenzone:** Das Eingabefeld sitzt unten, Details öffnen als Bottom-Sheet, die Geschäfte sind wischbare Tabs. Alles Wichtige ist einhändig erreichbar.
- **Ruhige, kompakte Liste:**
  - Zeilen 44 dp hoch (gerade noch bequem zu treffen), Schrift 16 px. „von Anna“ steht in derselben Zeile, damit viel auf eine Seite passt.
  - Warengruppen als dezente, mitlaufende Zwischenüberschriften.
  - Nichts springt: Abhaken ändert keine Position, Ein- und Ausblenden ist animiert.
- **Zustand auf einen Blick:** offen = kräftig, abgehakt = grau und durchgestrichen, „nur hier“ = Punkt in der Farbe des Geschäfts.
- **Farbe pro Geschäft** nur als Akzent (Tab-Unterstrich, Punkte), sonst zurückhaltend. Hell- und Dunkelmodus folgen dem System.
- **Feedback:** kurze Vibration beim Abhaken. Statt Bestätigungsdialogen gibt es eine Undo-Snackbar.
- **Sync-Status unaufdringlich** als Wolken-Symbol in der Kopfzeile: synchron / läuft / offline mit „n Änderungen warten“.
- **Android-Gefühl:**
  - installierbar, Vollbild, passende `theme-color`, Safe-Areas
  - kein versehentliches Pull-to-Refresh
  - kein Zoom beim Tippen ins Eingabefeld (Schrift mindestens 16 px)
- **Schnell:** Start aus dem Cache in unter 1 s, auch mit 300 Einträgen flüssig.

### 4.2 Hauptansicht (Liste „Lebensmittel“, Geschäft Kaufland, Modus „Alles hier“)

```
┌──────────────────────────────────────┐
│ Lebensmittel ▾                 ☁ ⋮   │  ← Listenwechsel · Sync-Status
│  Aldi 9   Kaufland 2   dm 3   Alle   │  ← wischbare Tabs
│           ━━━━━━━━━━                 │
│ [Alles hier ●|Nur für hier] [◉ Erl.] │  ← Ansichtsmodus · Erledigte ein/aus
├──────────────────────────────────────┤
│ OBST & GEMÜSE                        │
│ ○ Bananen                            │
│ ✓ Äpfel 1 kg              grau, Anna │  ← bleibt stehen
│ GEWÜRZE                              │
│ ● Sumach                             │  ← Punkt = nur hier
│ KÜHLUNG                              │
│ ○ Milch 2×                           │
│                                      │
│ ▸ Aus Drogerie (2)                   │  ← listenübergreifend
│ ▸ Nicht hier erhältlich (1)          │
├──────────────────────────────────────┤
│ [ + Artikel hinzufügen…          🎤 ] │  ← Daumenzone
└──────────────────────────────────────┘
```

- „Alle“ ist die Planungsansicht, gruppiert nach primärem Geschäft.
- Antippen hakt ab. **Long-Press** öffnet das Bearbeiten-Menü mit Menge, Notiz, Gibt’s bei, Warengruppe, Liste und „Von der Liste“ (mit Rückgängig).

### 4.3 Hinzufügen
- Ein Eingabefeld mit Autocomplete aus dem Katalog, gerankt nach Häufigkeit und Aktualität. Treffer aus anderen Listen werden markiert.
- Mengen werden aus der Eingabe gelesen: „2 Milch“, „Tomaten 500g“.
- Bei einem **neuen** Artikel öffnet sich ein Bottom-Sheet mit Warengruppe (vorgeschlagen) und den Chips `Gibt's bei: [✓Aldi] [Kaufland] [dm]`.
- Bei leerem Feld erscheinen Chips mit „Häufig gekauft“.

### 4.4 Einkaufsmodus, Sortieren & Einstellungen
- **Einkaufsmodus** (⋮-Menü): Display bleibt an (Wake Lock), Zeilen 54 statt 44 px, Abgleich alle 30 statt 300 s. Eine Leiste zeigt ihn an und beendet ihn.
- **Reihenfolge ändern** (⋮-Menü, im Geschäft): Artikel innerhalb einer Warengruppe am Griff ziehen.
  - Die Position gilt pro Geschäft.
  - Artikel, die gerade nicht auf der Liste stehen, behalten ihren Platz.
- **Einstellungen** (⋮ → Einstellungen):
  - Darstellung (Automatisch/Hell/Dunkel).
  - Listen: Geschäfte mit Priorität per Drag & Drop, Standardliste.
  - Geschäfte: Name, Farbe, Laufweg per Drag & Drop.
  - Warengruppen, Geräte & Mitglieder (umbenennen, entfernen, einladen), Import, dieses Gerät abmelden.

---

## 5. Offline (höchste Priorität)

**Anforderungen**
- Nach der ersten Installation startet die App **ohne Netz** vollständig mit dem letzten Stand.
- **Alle** Aktionen funktionieren offline: hinzufügen, abhaken, ändern, sortieren, Einkauf abschließen.
- Sobald wieder Netz da ist, werden die Änderungen automatisch abgeglichen, ohne Duplikate und ohne Datenverlust.
- Offline-Zustand und wartende Änderungen sind sichtbar, aber unaufdringlich.
- **App-Updates unterbrechen nie einen Einkauf.** Eine neue Version wird erst beim nächsten Start aktiv.

**Umsetzung**
- Ein Service Worker (Workbox über `vite-plugin-pwa`) speichert die komplette App vorab. API-Aufrufe laufen nie über den Service-Worker-Cache.
- Die Daten liegen in IndexedDB (Dexie), die UI liest nur lokal. Dadurch gibt es keinen Ladespinner, auch online nicht.
- Eine Outbox mit idempotenten Mutationen. Abgeglichen wird beim App-Start, beim Sichtbarwerden, beim `online`-Event, 1,5 s nach jeder Änderung und alle 300 s (im Einkaufsmodus alle 30 s), solange die App sichtbar ist. Dazu kommen Runterziehen der Liste, „Jetzt synchronisieren“ im ⋮-Menü und ein Tipp auf den Sync-Status.
- `navigator.storage.persist()` anfragen, damit Android den Speicher nicht räumt.
- **Background Sync** (Chrome/Android): Schlägt ein Abgleich offline fehl, meldet die App beim Service Worker einen Sync an. Sobald wieder Netz da ist, lädt er die Outbox direkt aus IndexedDB hoch, auch wenn die App geschlossen ist ([app/src/sw.ts](app/src/sw.ts)).
- Der Service Worker registriert sich schon auf dem Einrichtungsbildschirm, die App ist also ab dem ersten Öffnen offline verfügbar.

**Abnahmetests**
1. Im Flugmodus die App vom Homescreen starten: Die Liste ist da, Abhaken funktioniert.
2. Zwei Handys sind offline und ändern dieselbe Liste, auch denselben Artikel. Wenn beide wieder online sind, haben sie denselben Stand, ohne Duplikate.
3. Offline 10 Artikel anlegen, die App schließen und später online öffnen: Alles ist beim anderen Gerät angekommen.
4. Während eines Einkaufs eine neue Version deployen: Die App lädt nicht neu, sondern zeigt „Update beim nächsten Start“.

---

## 6. Datenmodell (SQLite-Dialekt, so umgesetzt)

**Tabellen** ([server/migrations/0001_init.sql](server/migrations/0001_init.sql)):
```
households  id, name, rev, created_at              ← rev = Sync-Zähler
members     id, household_id, name, token_hash, created_at, revoked_at
invites     code_hash, household_id, created_by, expires_at
fields      household_id, tbl, rid, field, value JSON, ts, mid, rev
            PRIMARY KEY (household_id, tbl, rid, field)
```

Alle synchronisierten Daten liegen in `fields`, **ein Feld pro Zeile**. Daraus setzt die App diese Datensätze zusammen ([shared/model.ts](shared/model.ts)):
```
list      name, sort, isDefault, storeIds[]        ← Reihenfolge = Priorität
store     name, color, sort, route[]               ← Laufweg der Warengruppen
category  name, sort                               ← Warengruppen
product   name, listId, categoryId, avail[],       ← avail = das „Tagging“
          pos:<storeId>, useCount, lastUsedAt      ← pos: Reihenfolge je Laden (für Phase 3)
entry     qty, note, onlyStore, checked, checkedBy, checkedAt, addedBy, addedAt
member    name                                     ← nur der Server schreibt
Löschen = Feld _deleted
```

**Entscheidungen**
- **Last-Write-Wins pro Feld macht die Datenbank selbst:** Der Upsert schreibt nur, wenn `(ts, mid)` neuer ist als der gespeicherte Stand. Das ist idempotent, braucht keine Transaktion über mehrere Requests und keine Tabelle für schon verarbeitete Mutationen.
- **Entry-ID = Product-ID:** Ein Artikel kann nur einmal offen auf der Liste stehen. Fügen zwei Personen gleichzeitig „Milch“ hinzu, entsteht kein Duplikat.
- **Product-ID wird aus dem normalisierten Namen abgeleitet:** Legen zwei Geräte offline „Milch“ an, wird daraus derselbe Artikel.
- **Store-Ansichten werden komplett im Client abgeleitet.**
  - Filter: `only_store == s` oder (`!only_store` und `s ∈ available_at`), für „Nur für hier“ zusätzlich `primary(entry) == s`
  - Sortierschlüssel: `(category_order.indexOf(category_id), position[s], name)`. **`checked` gehört nicht zum Sortierschlüssel.**

---

### 6.1 Sicherungsformat (JSON)

Export und Import unter ⋮ → Einstellungen → „Daten sichern & wiederherstellen“. Die Datei enthält alle Datensätze außer Geräten/Mitgliedern ([shared/backup.ts](shared/backup.ts)):

```json
{
  "format": "einkaufsliste-backup",
  "version": 1,
  "exportedAt": "2026-10-03T12:00:00.000Z",
  "household": "Moosies",
  "records": [
    { "tbl": "store",    "rid": "aldi",    "data": { "name": "Aldi", "color": "#2B59C3", "route": ["obst", "brot", "kuehl"], "sort": 0 } },
    { "tbl": "list",     "rid": "leb",     "data": { "name": "Lebensmittel", "storeIds": ["aldi", "kaufland", "dm"], "isDefault": true, "sort": 0 } },
    { "tbl": "category", "rid": "kuehl",   "data": { "name": "Kühlregal", "sort": 2 } },
    { "tbl": "product",  "rid": "p:milch", "data": { "name": "Milch", "listId": "leb", "categoryId": "kuehl", "avail": ["aldi", "kaufland"], "pos:aldi": "000010", "useCount": 3, "lastUsedAt": 0 } },
    { "tbl": "entry",    "rid": "p:milch", "data": { "qty": "2×", "note": "", "checked": false } }
  ]
}
```

- `rid` eines Eintrags ist die Produkt-ID. Produkt-IDs sind frei wählbar, die App erzeugt sie als `p:` plus kleingeschriebenem Namen.
- **Zusammenführen:** Datensätze aus der Datei überschreiben gleichnamige, alles andere bleibt.
- **Alles ersetzen:** Was nicht in der Datei steht, wird gelöscht. Felder, die in der Datei fehlen, werden geleert.
- Ungültige Datensätze oder Felder werden übersprungen und gezählt.

## 7. Architektur

### 7.1 Überblick (Betrieb auf Bunny)

```
┌──────────── Android: installierte PWA ────────────┐
│ UI ⇄ IndexedDB · Outbox · Service Worker (Cache)   │
└──────┬────────────────────────────────┬───────────┘
       │ App-Dateien (einmal laden,     │ POST /api/sync (Push + Pull,
       │ danach offline aus dem Cache)  │ alle 30 s solange sichtbar)
       ▼                                ▼
┌──────────────────────┐    ┌────────────────────────────┐
│ Bunny Sites          │    │ Bunny Edge Script (Deno)   │
│ Storage + Pull Zone  │    │ Hono · Sync · Auth         │
│ APP_DOMAIN           │    │ API_DOMAIN                 │
└──────────────────────┘    └─────────────┬──────────────┘
                                          │ libSQL über HTTP
                                          ▼
                            ┌────────────────────────────┐
                            │ Bunny Database (Primary DE)│
                            └────────────────────────────┘
```

- **Zwei Hostnamen** (App und API) brauchen CORS. Die App authentifiziert sich per Bearer-Token statt Cookies, und der Preflight wird gecacht (`Access-Control-Max-Age`). Die API akzeptiert alle Origins aus `ALLOWED_ORIGINS`, also `*.b-cdn.net` und die eigene Domain. So funktioniert der Wechsel auf die Domain ohne Unterbrechung.
- **Portabel:** Derselbe Server läuft lokal per `Deno.serve` mit einer SQLite-Datei (Entwicklung) oder in Docker, dort mit WebSocket-Push. Für den Betrieb auf Bunny ist das nicht nötig.

### 7.2 Sync (offline-first, eigenes schlankes Protokoll)
- **Client:** IndexedDB hält den bestätigten Server-Stand und eine **Outbox** mit eigenen Änderungen. Die UI zeigt immer beides übereinander.
- **Mutation:** `{ mid (UUID), tbl, rid, fields{…}, ts }`. `ts` steigt pro Gerät monoton, `mid` entscheidet bei Gleichstand.
- **`POST /api/sync`** erledigt Push und Pull in **einem atomaren Batch, also einem Request**:
  - Für jedes Feld `UPDATE households SET rev = rev + 1` und einen Upsert mit Bedingung `excluded.ts > ts OR (= AND excluded.mid > mid)`.
  - Als letzte Anweisung im selben Batch: alle Felder mit `rev > cursor` (höchstens 1000, dann `hasMore`).
  - Was der Server bestätigt hat, fliegt aus der Outbox.
- **Schutz:** Zeitstempel höchstens 60 s in der Zukunft (falsch gehende Handy-Uhren), strenge Prüfung von Tabelle, Feldnamen und Größen, `member` nur serverseitig.
- **Polling alle 300 s, im Einkaufsmodus alle 30 s, dazu sofort beim Öffnen und beim Runterziehen:** Edge Scripts haben keinen Broadcast zwischen Instanzen. Eine Abfrage kostet etwa 80 ms.
- **Fehlerverhalten:** Keine Verbindung oder 502/503/504 gilt als „Offline“, die Outbox bleibt erhalten. Bei 401 meldet die App, dass das Gerät abgemeldet ist.

### 7.3 Zugang
- **Neuen Haushalt anlegen** geht nur mit dem **Einrichtungscode** (Secret `SETUP_CODE` im Edge Script). `deploy.ps1` erzeugt ihn beim ersten Deploy zufällig und legt ihn in `.env` ab. Ohne gesetztes Secret ist das Anlegen gesperrt.
- **Alle anderen** treten per **Einladungslink** bei (⋮ → „Mitglied einladen“, 7 Tage gültig, mehrfach nutzbar, teilbar z. B. per WhatsApp).
- **Danach bleibt das Gerät angemeldet:** Es bekommt einen zufälligen Geräte-Schlüssel (wirkt wie ein dauerhaftes Cookie), in der DB liegt nur der Hash.
- **Mehrere Haushalte** sind möglich und strikt getrennt.
- Später: Geräte in den Einstellungen widerrufen, optional Login per E-Mail-Link (bräuchte einen Mail-Dienst).

### 7.4 Stack
- **Frontend** (Node 24/npm): React 19 + TypeScript 7 + Vite 8, `vite-plugin-pwa`, Dexie, Schrift Figtree (selbst gehostet, also offline verfügbar).
- **Backend** (Deno 2): Hono, `@libsql/client/web` für Bunny DB, `node:sqlite` für lokal/Docker. Dazwischen ein dünner DB-Adapter (`execute`, `batch`).
- **Shared:** Typen, Seed, Ansichtslogik und Mengen-Parser. Reines TypeScript ohne Abhängigkeiten, von beiden Seiten importiert.

### 7.5 Repo-Struktur

```
shoppinglist/
  deno.json         Tasks (dev, test, check) und Imports für Server + Shared
  app/              PWA (Vite + React + TS)
    src/lib/        store.ts (Sync-Engine), actions.ts, db.ts, api.ts, prefs.ts
    src/components/ Main, ItemRow, Sheets (Hinzufügen, Bearbeiten, Einladen), Onboarding
    scripts/icons.mjs  erzeugt die App-Icons
  server/
    app.ts          Hono-App (Routen, Zugang, Sync)
    auth.ts, sync.ts
    bunny.ts        Einstieg Edge Script
    main.ts         Einstieg lokal/Docker (Deno.serve, SQLite-Datei, liefert app/dist aus)
    db/             libsql.ts, sqlite.ts
    migrations/     0001_init.sql …   (Bunny: `bunny db migrations apply`)
  shared/           model.ts, view.ts, seed.ts, parse.ts (+ Tests)
  deploy/           config.env, lib.ps1, setup.ps1, deploy.ps1, domains.ps1, build-api.ts
```

**Lokal entwickeln:** `deno task dev` (API auf :8787 mit SQLite in `server/data/`) und `npm --prefix app run dev` (App auf :5180, Proxy auf die API). Tests: `deno task test`.

---

## 8. Deployment (Bunny CLI)

| Ressource | Zweck | Angelegt durch |
|---|---|---|
| Bunny Database `einkauf` (Primary DE) | Daten | `bunny db create` |
| Edge Script `einkauf-api` (standalone, eigene Pull Zone) | API | `bunny scripts create` |
| Site `einkauf` (Storage + Pull Zone, SPA) | PWA | `bunny sites create` |

**Einmalig**
1. Voraussetzungen installieren: Bunny CLI ab 0.18, **Deno 2**, Node 24, PowerShell 7 (die Skripte laufen unter Windows und ebenso in einer Linux-CI).
2. `bunny login --profile <name>`. Das Profil steht als `BUNNY_PROFILE` in `deploy/config.env` und wird an jeden Bunny-Aufruf angehängt. Achtung: Ein gesetztes `BUNNYNET_API_KEY` hätte Vorrang, die Skripte warnen dann.
3. Namen und Region in [deploy/config.env](deploy/config.env) prüfen.
4. `.\deploy\setup.ps1` ausführen. Das Skript:
   - legt die DB an; der Token landet in `.env`
   - legt das Edge Script an und hinterlegt den DB-Zugang als Secret
   - legt die Site an und verknüpft alles in `.bunny/`
   - gibt am Ende die **CNAME-Einträge** für die Domains aus

**Bei jedem Deploy:** `.\deploy\deploy.ps1`, oder einzelne Schritte, z. B. `.\deploy\deploy.ps1 api web`.
1. `bunny db migrations apply --dir server/migrations`. Migrationen sind nur additiv, damit ältere App-Versionen auf den Handys weiterlaufen.
2. Die API wird gebündelt (esbuild + Deno-Loader, wie in Bunnys Template). `ALLOWED_ORIGINS` und `SETUP_CODE` werden gesetzt, beim ersten Mal wird der Code erzeugt und in `.env` abgelegt. Danach folgt `bunny scripts deploy`.
3. Die PWA wird mit `VITE_API_URL` gebaut und mit `bunny sites deploy --spa` hochgeladen.

**Rollback**
- PWA: `bunny sites deployments publish --previous` (jeder Deploy bleibt unverändert erhalten).
- API: `bunny scripts deployments publish <id>`.

**Domain** (`einkauf.example.com` und `api.einkauf.example.com`, steht in `deploy/config.env`):
1. Nach `setup.ps1` die beiden ausgegebenen CNAME-Einträge beim DNS-Anbieter anlegen.
2. `.\deploy\domains.ps1` ausführen. Das Skript:
   - verknüpft die Domains und wartet bis zu 10 Minuten auf DNS
   - stellt die SSL-Zertifikate aus
   - deployt API und PWA mit den neuen Adressen

Es kann gefahrlos erneut laufen. Bis die Domains verknüpft sind, nutzen alle Skripte automatisch die `*.b-cdn.net`-Adressen.

**Wichtig:** Die PWA erst *nach* dem Domain-Wechsel auf den Handys installieren. Jede Adresse ist für den Browser eine eigene App mit eigenem Offline-Speicher.

---

## 9. Umsetzungsplan

**Stand:** Die Phasen 0–3 sind umgesetzt und live unter https://einkauf.example.com. Offen ist Phase 4.

**Phase 0 – Skelett & Pipeline**
- `app/`, `server/` und `shared/` anlegen, Bunny-Ressourcen per `setup.ps1` einrichten.
- Erster Deploy als „Hello World“: PWA installierbar, startet offline, `/api/health` antwortet.
- **Klick-Prototyp fürs Handy**, um Optik und Bedienung vor der Umsetzung abzustimmen.

**Phase 1 – Sync-Kern**
- Outbox, `/api/sync`, LWW pro Feld, Tombstones, Polling.
- Die Offline-Abnahmetests aus Abschnitt 5 laufen automatisiert, mit zwei simulierten Clients.

**Phase 2 – MVP (ersetzt Listonic)**
- Haushalt anlegen, per Einladungslink und Geräte-Token beitreten.
- Testkonfiguration als Seed: Listen, Geschäfte mit Priorität, Warengruppen.
- Hinzufügen mit Autocomplete und Verfügbarkeits-Chips.
- Store-Tabs mit stabiler Sortierung, Ansichtsumschalter und listenübergreifenden Gruppen.
- „Nicht hier erhältlich“, „Einkauf abschließen“, Sync-Status.

**Phase 3 – Komfort** ✓
- Laufweg-Editor und Sortieren per Drag & Drop (`@dnd-kit`, auch per Tastatur).
- Listen, Geschäfte und Warengruppen in der App verwalten. Geräte umbenennen bzw. entfernen (`POST /api/me`, `POST /api/members/:id/revoke`).
- Einkaufsmodus, Background Sync, Import per Text (z. B. aus Listonic), Dark Mode, Mengen-Schnellwahl.

**Phase 4 – Nice-to-have**
- Laufweg lernen, Teilen-Ziel, Spracheingabe, Presence.
- Passkeys/Google-Login, GitHub Action für automatische Deploys.

---

## 10. Risiken

- **Das eigene Sync-Protokoll ist der größte Brocken.** Deshalb kommt es in Phase 1 und wird gegen die Abnahmetests geprüft. Fertige Sync-Engines (PowerSync, ElectricSQL, Zero) setzen Postgres voraus.
- **Bunny Database ist laut Doku noch Public Preview.** Das heißt: 1 GB pro DB, und bei einem Failover können bis zu 10 s Daten verloren gehen. Für eine Einkaufsliste ist das unkritisch, und der DB-Adapter hält den Ausstieg offen.
- **`bunny sites` ist in der CLI noch als experimentell markiert** und taucht nicht in `--help` auf. Fallback: Storage Zone + Pull Zone + `bunny storage files upload`.
- **PWA-Speicher kann gelöscht werden.** Gegenmaßnahme: `navigator.storage.persist()` anfragen. Im schlimmsten Fall gehen ungesyncte Änderungen verloren und das Gerät braucht eine neue Einladung.

---

## 11. Offene Fragen

1. Sollen die Einträge anderer Listen als eigene Gruppe unten stehen (so umgesetzt) oder direkt in den Laufweg einsortiert werden, mit einem Listen-Chip (Prototyp B)?
2. Sind strukturierte Mengen und Einheiten nötig, oder reicht Freitext (so umgesetzt)?
3. Warengruppen: vorgegebene Seed-Liste (so umgesetzt) oder komplett selbst gepflegt? Und wer darf den Laufweg pflegen?
4. Sollen die Daten aus Listonic übernommen werden?
