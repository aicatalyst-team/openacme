import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDataDir, type Config } from "@openacme/config";
import { WasmDatabase } from "./wasm/adapter.js";
import { drizzle } from "./wasm/drizzle.js";
import { migrate } from "./wasm/migrate.js";
import { recoverWalDatabase } from "./wasm/wal-recover.js";

/**
 * Open the SQLite database for OpenAcme and apply any pending migrations.
 *
 * Backed by node-sqlite3-wasm (WASM SQLite) through {@link WasmDatabase}, so
 * the install needs no native compiler on any platform. The stores keep
 * driving it through a better-sqlite3-shaped surface.
 *
 * Schema is owned by drizzle: edit `src/schema.ts`, run `pnpm db:generate`
 * to produce a new migration in `drizzle/`, commit both. At runtime the
 * migrator applies anything not yet recorded in `__drizzle_migrations`.
 * Never write `ALTER TABLE` by hand — let drizzle-kit generate it.
 */
export function createDatabase(config: Config): WasmDatabase {
  const dataDir = resolveDataDir(config.dataDir);
  const dbPath = path.join(dataDir, "state.db");
  // Upgrade path: ≤0.8 left the file in WAL mode, which the WASM engine can't
  // open. Convert it to rollback journaling before the first query. No-op for
  // databases the WASM engine already owns.
  recoverWalDatabase(dbPath);
  const db = new WasmDatabase(dbPath);
  db.pragma("foreign_keys = ON");
  // WAL is unavailable on the WASM VFS (no shared memory); the default
  // rollback journal serialises writers. busy_timeout lets a concurrent
  // reader (e.g. a CLI command opening state.db) wait out a write instead
  // of erroring.
  db.pragma("busy_timeout = 5000");
  applySchema(db);
  return db;
}

/**
 * Apply all migrations to a database. Used by `createDatabase` and by
 * tests to bootstrap an in-memory db.
 */
export function applySchema(db: WasmDatabase): void {
  migrate(drizzle(db), { migrationsFolder: MIGRATIONS_FOLDER });
}

// Resolve the migrations folder relative to this module. Works in both
// development (TS source under `src/`) and after build (JS under `dist/`)
// since `drizzle/` is a sibling of both.
const MIGRATIONS_FOLDER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "drizzle"
);
