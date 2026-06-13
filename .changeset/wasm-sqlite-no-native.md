---
"@openacme/db": minor
---

Eliminate native dependencies so `npm i -g @openacme/cli` works on any machine without a compiler.

- **SQLite:** replace `better-sqlite3` (native) with `node-sqlite3-wasm` (pure WASM). The stores keep driving the DB through a better-sqlite3-shaped adapter + a vendored drizzle session over `drizzle-orm/sqlite-core`, so query logic is unchanged. Migrations reuse drizzle's own `readMigrationFiles` + `dialect.migrate`, so existing databases are recognised and only pending migrations apply. WAL is unavailable on the WASM VFS; the connection uses `busy_timeout` instead (immaterial for a single local daemon).
- **Image processing:** replace `sharp` (native) with `jimp` (pure JS) for screenshot downscaling.
- **Browser:** move `camoufox-js` (pulls native `better-sqlite3`/`impit`) to `optionalDependencies`; it is already lazy-loaded with a graceful fallback, so a failed install no longer breaks the CLI.
- **CLI:** `openacme start` no longer crashes on headless boxes when no browser opener (`xdg-open`) is present — browser auto-open is now best-effort.
