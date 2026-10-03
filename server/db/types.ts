// Dünne Datenbank-Schnittstelle: dieselbe Server-Logik läuft auf Bunny Database (libSQL über HTTP)
// und lokal auf einer SQLite-Datei. Bewusst ohne interaktive Transaktionen – alles, was atomar
// sein muss, geht als ein Batch in einem Roundtrip.

export type SqlValue = string | number | null;
export type Row = Record<string, SqlValue>;

export interface Stmt {
  sql: string;
  args?: SqlValue[];
}

export interface Db {
  execute(sql: string, args?: SqlValue[]): Promise<Row[]>;
  /** Führt alle Anweisungen in einer Schreib-Transaktion aus und liefert die Zeilen jeder Anweisung. */
  batch(stmts: Stmt[]): Promise<Row[][]>;
  close(): void;
}
