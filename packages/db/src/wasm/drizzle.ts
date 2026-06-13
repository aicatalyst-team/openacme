/**
 * Vendored drizzle SQLite session over the {@link WasmDatabase} adapter.
 *
 * drizzle ships a `drizzle-orm/better-sqlite3` entrypoint, but its driver
 * module does a top-level `import "better-sqlite3"` — importing it at all
 * drags the native package back into the install closure. This is a faithful
 * copy of that driver's session/prepared-query/transaction glue, built on the
 * public `drizzle-orm/sqlite-core` primitives instead, so nothing native is
 * referenced. The adapter mirrors better-sqlite3's statement API, so the
 * logic here is unchanged from drizzle's own.
 *
 * The drizzle-internal generics (schema config, prepared-query config) are
 * intentionally loose — this is plumbing, the typed surface is the returned
 * BaseSQLiteDatabase and the WasmDatabase adapter.
 */
import { entityKind, fillPlaceholders, sql, NoopLogger } from "drizzle-orm";
import * as DrizzleInternal from "drizzle-orm";
import { NoopCache } from "drizzle-orm/cache/core";
import {
  BaseSQLiteDatabase,
  SQLiteSession,
  SQLitePreparedQuery,
  SQLiteTransaction,
  SQLiteSyncDialect,
} from "drizzle-orm/sqlite-core";
import type { RunResult, WasmDatabase, WasmStatement } from "./adapter.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

// mapResultRow is a runtime export of drizzle-orm but absent from its public
// type surface; reach it through the namespace.
const mapResultRow = (
  DrizzleInternal as unknown as {
    mapResultRow: (fields: any, row: unknown, joins: any) => any;
  }
).mapResultRow;

class WasmPreparedQuery extends (SQLitePreparedQuery as any) {
  static readonly [entityKind] = "WasmPreparedQuery";
  private stmt: WasmStatement;
  private logger: any;
  private fields: any;
  private _arr: boolean;
  private customResultMapper: any;

  constructor(
    stmt: WasmStatement,
    query: any,
    logger: any,
    cache: any,
    queryMetadata: any,
    cacheConfig: any,
    fields: any,
    executeMethod: any,
    isResponseInArrayMode: boolean,
    customResultMapper: any
  ) {
    super("sync", executeMethod, query, cache, queryMetadata, cacheConfig);
    this.stmt = stmt;
    this.logger = logger;
    this.fields = fields;
    this._arr = isResponseInArrayMode;
    this.customResultMapper = customResultMapper;
  }

  run(placeholderValues?: Record<string, unknown>): RunResult {
    const params = fillPlaceholders((this as any).query.params, placeholderValues ?? {});
    this.logger.logQuery((this as any).query.sql, params);
    return this.stmt.run(...params);
  }

  all(placeholderValues?: Record<string, unknown>): unknown[] {
    const { fields, customResultMapper } = this;
    const query = (this as any).query;
    if (!fields && !customResultMapper) {
      const params = fillPlaceholders(query.params, placeholderValues ?? {});
      this.logger.logQuery(query.sql, params);
      return this.stmt.all(...params);
    }
    const rows = this.values(placeholderValues);
    if (customResultMapper) return customResultMapper(rows);
    return rows.map((row) =>
      mapResultRow(fields, row, (this as any).joinsNotNullableMap)
    );
  }

  get(placeholderValues?: Record<string, unknown>): unknown {
    const query = (this as any).query;
    const params = fillPlaceholders(query.params, placeholderValues ?? {});
    this.logger.logQuery(query.sql, params);
    const { fields, stmt, customResultMapper } = this;
    if (!fields && !customResultMapper) return stmt.get(...params);
    const row = stmt.raw().get(...params);
    if (!row) return undefined;
    if (customResultMapper) return customResultMapper([row]);
    return mapResultRow(fields, row, (this as any).joinsNotNullableMap);
  }

  values(placeholderValues?: Record<string, unknown>): unknown[] {
    const query = (this as any).query;
    const params = fillPlaceholders(query.params, placeholderValues ?? {});
    this.logger.logQuery(query.sql, params);
    return this.stmt.raw().all(...params);
  }

  isResponseInArrayMode(): boolean {
    return this._arr;
  }
}

class WasmTransaction extends (SQLiteTransaction as any) {
  static readonly [entityKind] = "WasmTransaction";

  transaction(transaction: (tx: WasmTransaction) => unknown): unknown {
    const savepoint = `sp${(this as any).nestedIndex}`;
    const tx = new (WasmTransaction as any)(
      "sync",
      (this as any).dialect,
      (this as any).session,
      (this as any).schema,
      (this as any).nestedIndex + 1
    );
    (this as any).session.run(sql.raw(`savepoint ${savepoint}`));
    try {
      const result = transaction(tx);
      (this as any).session.run(sql.raw(`release savepoint ${savepoint}`));
      return result;
    } catch (err) {
      (this as any).session.run(sql.raw(`rollback to savepoint ${savepoint}`));
      throw err;
    }
  }
}

class WasmSession extends (SQLiteSession as any) {
  static readonly [entityKind] = "WasmSession";
  private client: WasmDatabase;
  private schema: any;
  private logger: any;
  private cache: any;

  constructor(client: WasmDatabase, dialect: any, schema: any, options: any = {}) {
    super(dialect);
    this.client = client;
    this.schema = schema;
    this.logger = options.logger ?? new NoopLogger();
    this.cache = options.cache ?? new NoopCache();
  }

  prepareQuery(
    query: any,
    fields: any,
    executeMethod: any,
    isResponseInArrayMode: boolean,
    customResultMapper: any,
    queryMetadata: any,
    cacheConfig: any
  ): any {
    const stmt = this.client.prepare(query.sql);
    return new WasmPreparedQuery(
      stmt,
      query,
      this.logger,
      this.cache,
      queryMetadata,
      cacheConfig,
      fields,
      executeMethod,
      isResponseInArrayMode,
      customResultMapper
    );
  }

  transaction(transaction: (tx: any) => unknown, config: any = {}): unknown {
    const tx = new (WasmTransaction as any)("sync", (this as any).dialect, this, this.schema);
    const nativeTx = this.client.transaction(transaction as any);
    const behavior = config.behavior ?? "deferred";
    return (nativeTx as any)[behavior](tx);
  }
}

export type WasmDrizzleDatabase = BaseSQLiteDatabase<"sync", RunResult>;

export function drizzle(client: WasmDatabase): WasmDrizzleDatabase {
  const dialect = new SQLiteSyncDialect();
  const session = new WasmSession(client, dialect, undefined, {});
  return new (BaseSQLiteDatabase as any)("sync", dialect, session, undefined);
}
