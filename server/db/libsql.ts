// Bunny Database (libSQL) über HTTP – nur fetch, läuft im Edge Script.
import { createClient, type ResultSet } from "@libsql/client/web";
import type { Db, Row, SqlValue } from "./types.ts";

function toRows(rs: ResultSet): Row[] {
  return rs.rows.map((r) => {
    const row: Row = {};
    rs.columns.forEach((col, i) => {
      const v = r[i];
      row[col] = typeof v === "bigint" ? Number(v) : (v as SqlValue);
    });
    return row;
  });
}

export function libsqlDb(url: string, authToken?: string): Db {
  const client = createClient({ url, authToken });
  return {
    async execute(sql, args = []) {
      return toRows(await client.execute({ sql, args }));
    },
    async batch(stmts) {
      const results = await client.batch(stmts.map((s) => ({ sql: s.sql, args: s.args ?? [] })), "write");
      return results.map(toRows);
    },
    close: () => client.close(),
  };
}
