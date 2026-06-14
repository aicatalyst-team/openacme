---
"@openacme/db": patch
---

Fix a crash when upgrading from 0.8.x: the WASM SQLite engine can't open a database left in WAL mode by the previous (better-sqlite3) engine, so the daemon failed on first query with `unable to open database file`.

`createDatabase` now detects a WAL-mode file on open and converts it in pure JS — it checkpoints the committed WAL frames into the main database, switches the header to rollback journal mode, and removes the `-wal`/`-shm` sidecars. No native code and no data loss; verified byte-for-byte against better-sqlite3's own checkpoint. The conversion is a one-time no-op for databases the WASM engine already owns.
