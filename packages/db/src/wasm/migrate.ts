/**
 * Migration runner over the {@link WasmDatabase} adapter. Mirrors
 * `drizzle-orm/better-sqlite3/migrator` — which we can't import because it
 * pulls in the native driver — by reusing drizzle's own `readMigrationFiles`
 * and `dialect.migrate`. Same `__drizzle_migrations` table and content hashes,
 * so a database already migrated by the native runner is recognised and
 * pending-only migrations apply.
 */
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { WasmDrizzleDatabase } from "./drizzle.js";

export function migrate(
  db: WasmDrizzleDatabase,
  config: { migrationsFolder: string }
): void {
  const migrations = readMigrationFiles(config);
  const internal = db as unknown as {
    dialect: { migrate: (m: unknown, s: unknown, c: unknown) => void };
    session: unknown;
  };
  internal.dialect.migrate(migrations, internal.session, config);
}
