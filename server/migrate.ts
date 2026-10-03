// Wendet die SQL-Migrationen lokal an (auf Bunny übernimmt das `bunny db migrations apply`).
import type { Db } from "./db/types.ts";

/** Zerlegt eine Migrationsdatei in einzelne Anweisungen (ohne Kommentarzeilen). */
export function splitSql(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function migrate(db: Db, dir: URL): Promise<string[]> {
  await db.execute("CREATE TABLE IF NOT EXISTS __local_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
  const done = new Set((await db.execute("SELECT name FROM __local_migrations")).map((r) => String(r.name)));
  const files = [...Deno.readDirSync(dir)].filter((e) => e.isFile && e.name.endsWith(".sql")).map((e) => e.name).sort();
  const applied: string[] = [];
  for (const name of files) {
    if (done.has(name)) continue;
    const stmts = splitSql(await Deno.readTextFile(new URL(name, dir))).map((sql) => ({ sql }));
    await db.batch([...stmts, { sql: "INSERT INTO __local_migrations (name, applied_at) VALUES (?, ?)", args: [name, Date.now()] }]);
    applied.push(name);
  }
  return applied;
}
