import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pool } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function run(): Promise<void> {
  await ensureMigrationsTable();
  const migrationsDir = path.join(__dirname, "migrations");
  const entries = (await readdir(migrationsDir)).filter((entry) => entry.endsWith(".sql")).sort();

  for (const entry of entries) {
    const alreadyApplied = await pool.query("SELECT 1 FROM schema_migrations WHERE id = $1", [entry]);
    if (alreadyApplied.rowCount) {
      continue;
    }

    const sql = await readFile(path.join(migrationsDir, entry), "utf8");
    await pool.query("BEGIN");
    try {
      await pool.query(sql);
      await pool.query("INSERT INTO schema_migrations (id) VALUES ($1)", [entry]);
      await pool.query("COMMIT");
      console.log(`Applied migration ${entry}`);
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
