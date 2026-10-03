// Lokale SQLite-Datei (Entwicklung, Docker/VM) über das eingebaute node:sqlite.
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Db, Row, SqlValue, Stmt } from "./types.ts";

export function sqliteDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

  const run = (sql: string, args: SqlValue[] = []): Row[] =>
    db.prepare(sql).all(...(args as SQLInputValue[])) as Row[];

  return {
    execute: (sql, args) => Promise.resolve(run(sql, args)),
    batch(stmts: Stmt[]) {
      // node:sqlite ist synchron: zwischen BEGIN und COMMIT kann keine andere Anfrage dazwischenkommen.
      db.exec("BEGIN IMMEDIATE");
      try {
        const out = stmts.map((s) => run(s.sql, s.args));
        db.exec("COMMIT");
        return Promise.resolve(out);
      } catch (err) {
        db.exec("ROLLBACK");
        return Promise.reject(err);
      }
    },
    close: () => db.close(),
  };
}
