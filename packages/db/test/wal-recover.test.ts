import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  copyFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { WasmDatabase } from "../src/wasm/adapter.js";
import { recoverWalDatabase } from "../src/wasm/wal-recover.js";

/**
 * Upgrade path: ≤0.8 (better-sqlite3) left databases in WAL mode, which the
 * WASM engine can't open. recoverWalDatabase must checkpoint + demote them.
 * better-sqlite3 is a dev-only fixture generator here — never shipped.
 */

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "openacme-walrec-"));
  dbPath = path.join(dir, "state.db");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Build a WAL-mode db with an UNCHECKPOINTED wal (the data lives in -wal, not
 *  the main file), like 0.8 leaves after a crash: multiple transactions + a
 *  page overwrite. better-sqlite3 checkpoints on close(), so we snapshot the
 *  on-disk files while the connection is still open, then close the source. */
function buildUncheckpointedWal(): void {
  const live = path.join(dir, "live.db");
  const db = new BetterSqlite3(live);
  db.pragma("journal_mode = WAL");
  db.pragma("wal_autocheckpoint = 0");
  db.exec("CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)");
  const ins = db.prepare("INSERT INTO t(v) VALUES(?)");
  db.transaction(() => {
    for (let i = 0; i < 200; i++) ins.run("alpha-" + i);
  })();
  db.transaction(() => {
    for (let i = 200; i < 400; i++) ins.run("beta-" + i);
  })();
  db.prepare("UPDATE t SET v = ? WHERE id = ?").run("OVERWRITTEN", 1);
  // Snapshot the committed-but-unchekpointed state (WAL holds all the data).
  for (const ext of ["", "-wal", "-shm"]) {
    if (existsSync(live + ext)) copyFileSync(live + ext, dbPath + ext);
  }
  db.close();
  rmSync(live, { force: true });
  rmSync(live + "-wal", { force: true });
  rmSync(live + "-shm", { force: true });
}

function headerJournalByte(): number {
  return readFileSync(dbPath)[18]!;
}

describe("recoverWalDatabase", () => {
  it("checkpoints an uncheckpointed WAL and lets the WASM engine read it", () => {
    buildUncheckpointedWal();
    expect(headerJournalByte()).toBe(2); // WAL
    expect(existsSync(dbPath + "-wal")).toBe(true);

    const converted = recoverWalDatabase(dbPath);
    expect(converted).toBe(true);
    expect(headerJournalByte()).toBe(1); // rollback
    expect(existsSync(dbPath + "-wal")).toBe(false);
    expect(existsSync(dbPath + "-shm")).toBe(false);

    const db = new WasmDatabase(dbPath);
    try {
      const n = db.prepare("SELECT count(*) AS n FROM t").get() as { n: number };
      expect(n.n).toBe(400);
      const overwritten = db
        .prepare("SELECT v FROM t WHERE id = 1")
        .get() as { v: string };
      expect(overwritten.v).toBe("OVERWRITTEN"); // latest page won
      const tail = db
        .prepare("SELECT v FROM t WHERE id = 400")
        .get() as { v: string };
      expect(tail.v).toBe("beta-399");
    } finally {
      db.close();
    }
  });

  it("handles a WAL-mode header with no -wal sidecar (cleanly closed)", () => {
    const db = new BetterSqlite3(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec("CREATE TABLE t(x)");
    db.prepare("INSERT INTO t VALUES(?)").run(42);
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.close();
    rmSync(dbPath + "-wal", { force: true });
    rmSync(dbPath + "-shm", { force: true });
    expect(headerJournalByte()).toBe(2);

    expect(recoverWalDatabase(dbPath)).toBe(true);
    expect(headerJournalByte()).toBe(1);

    const w = new WasmDatabase(dbPath);
    try {
      const row = w.prepare("SELECT x FROM t").get() as { x: number };
      expect(row.x).toBe(42);
    } finally {
      w.close();
    }
  });

  it("is a no-op on a rollback-mode database (WASM-created)", () => {
    const w = new WasmDatabase(dbPath);
    w.prepare("CREATE TABLE t(x)").run();
    w.prepare("INSERT INTO t VALUES(?)").run(7);
    w.close();
    expect(headerJournalByte()).toBe(1);

    expect(recoverWalDatabase(dbPath)).toBe(false);

    const w2 = new WasmDatabase(dbPath);
    try {
      const row = w2.prepare("SELECT x FROM t").get() as { x: number };
      expect(row.x).toBe(7);
    } finally {
      w2.close();
    }
  });

  it("is a no-op when the database file does not exist", () => {
    expect(recoverWalDatabase(path.join(dir, "nope.db"))).toBe(false);
  });
});
