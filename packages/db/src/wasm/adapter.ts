import pkg from "node-sqlite3-wasm";

const { Database: NativeDatabase } = pkg;
type Native = InstanceType<typeof NativeDatabase>;

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

/**
 * better-sqlite3-shaped statement. The stores and our vendored drizzle
 * session both drive the db through this surface, so the underlying
 * driver (node-sqlite3-wasm) stays an implementation detail.
 */
export interface WasmStatement<P extends unknown[] = unknown[], R = unknown> {
  run(...params: P): RunResult;
  get(...params: P): R | undefined;
  all(...params: P): R[];
  raw(): WasmStatement<P, unknown[]>;
  pluck(): WasmStatement<P, R>;
}

function isNamedBind(p: unknown[]): p is [Record<string, unknown>] {
  return (
    p.length === 1 &&
    p[0] !== null &&
    typeof p[0] === "object" &&
    !Array.isArray(p[0]) &&
    !(p[0] instanceof Uint8Array)
  );
}

// node-sqlite3-wasm binds named params by their full SQL token (sigil
// included); the stores follow better-sqlite3's sigil-less convention.
// Re-attach whichever sigil the SQL actually uses for each key.
function withSigil(
  sql: string,
  obj: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    let sigil = "@";
    for (const cand of ["@", ":", "$"]) {
      if (new RegExp(`\\${cand}${key}(?![A-Za-z0-9_])`).test(sql)) {
        sigil = cand;
        break;
      }
    }
    out[sigil + key] = obj[key];
  }
  return out;
}

type Bind = Parameters<Native["run"]>[1];

// Statement-less: node-sqlite3-wasm statements hold a lock until finalized,
// so a leaked `.get()` would block the next write. The DB-level run/all/get
// prepare+step+finalize per call — no lingering locks, no statement cleanup.
class Stmt {
  constructor(
    private readonly db: Native,
    private readonly sql: string,
    private readonly rawMode = false
  ) {}

  raw(): WasmStatement {
    return new Stmt(this.db, this.sql, true) as unknown as WasmStatement;
  }

  pluck(): WasmStatement {
    return this as unknown as WasmStatement;
  }

  private bind(p: unknown[]): Bind {
    if (p.length === 0) return undefined;
    if (isNamedBind(p)) return withSigil(this.sql, p[0]) as Bind;
    return p as Bind;
  }

  run(...p: unknown[]): RunResult {
    return this.db.run(this.sql, this.bind(p));
  }

  get(...p: unknown[]): unknown {
    const row = this.db.get(this.sql, this.bind(p));
    if (row == null) return undefined;
    return this.rawMode ? Object.values(row) : row;
  }

  all(...p: unknown[]): unknown[] {
    const rows = this.db.all(this.sql, this.bind(p));
    return this.rawMode ? rows.map((r) => Object.values(r)) : rows;
  }
}

type TxFn = ((...args: unknown[]) => unknown) & {
  deferred: (...args: unknown[]) => unknown;
  immediate: (...args: unknown[]) => unknown;
  exclusive: (...args: unknown[]) => unknown;
};

/**
 * better-sqlite3-compatible facade over node-sqlite3-wasm — the WASM SQLite
 * build that needs no native compile. Implements only the surface the stores
 * and the vendored drizzle session use: prepare / exec / pragma / transaction.
 */
export class WasmDatabase {
  readonly native: Native;

  constructor(file: string) {
    this.native = new NativeDatabase(file);
  }

  prepare<P extends unknown[] = unknown[], R = unknown>(
    sql: string
  ): WasmStatement<P, R> {
    return new Stmt(this.native, sql) as unknown as WasmStatement<P, R>;
  }

  exec(sql: string): this {
    this.native.exec(sql);
    return this;
  }

  pragma(source: string): unknown {
    const parts = String(source).split("=");
    const key = (parts[0] ?? "").trim();
    const valueRaw = parts[1];
    if (valueRaw !== undefined) {
      this.native.exec(`PRAGMA ${key} = ${valueRaw.trim()}`);
      return undefined;
    }
    return this.native.all(`PRAGMA ${key}`);
  }

  function(
    name: string,
    fn: (...args: never[]) => unknown
  ): this {
    this.native.function(name, fn as never);
    return this;
  }

  get inTransaction(): boolean {
    return this.native.inTransaction;
  }

  close(): void {
    this.native.close();
  }

  transaction(fn: (...args: unknown[]) => unknown): TxFn {
    const make =
      (mode: string) =>
      (...args: unknown[]): unknown => {
        this.native.exec(`BEGIN ${mode}`);
        try {
          const result = fn(...args);
          this.native.exec("COMMIT");
          return result;
        } catch (err) {
          try {
            if (this.native.inTransaction) this.native.exec("ROLLBACK");
          } catch {
            // surface the original error, not a rollback failure
          }
          throw err;
        }
      };
    const tx = make("DEFERRED") as TxFn;
    tx.deferred = make("DEFERRED");
    tx.immediate = make("IMMEDIATE");
    tx.exclusive = make("EXCLUSIVE");
    return tx;
  }
}
