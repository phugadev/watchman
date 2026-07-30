import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type DB = ReturnType<typeof create>;

function create() {
  const path = resolve(env.dbPath);
  mkdirSync(dirname(path), { recursive: true });

  const sqlite = new Database(path);

  /*
   * Pragma choices, all of which matter for a write-heavy monitoring workload:
   *
   *   WAL              readers never block the scheduler's writes, so rendering
   *                    the dashboard cannot stall a probe from recording
   *   synchronous      NORMAL rather than FULL: losing the last few check rows to
   *                    a hard power cut is acceptable, halving write latency is not
   *   busy_timeout     the scheduler and request handlers share one file; wait
   *                    instead of throwing SQLITE_BUSY
   *   foreign_keys     off by default in SQLite, and every cascade here depends
   *                    on it
   */
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("temp_store = MEMORY");
  // ~64MB page cache. Rollup aggregation scans wide time ranges.
  sqlite.pragma("cache_size = -64000");

  const db = drizzle(sqlite, { schema });

  const migrationsFolder = resolve("drizzle");
  if (existsSync(migrationsFolder)) {
    migrate(db, { migrationsFolder });
  } else {
    console.warn(
      "[watchman] no drizzle/ migrations folder found — run `pnpm db:generate`",
    );
  }

  return db;
}

/**
 * A single connection for the whole process, cached on globalThis so Next's dev
 * HMR does not open a new SQLite handle (and re-run migrations) on every edit.
 */
const globalForDb = globalThis as unknown as { __watchmanDb?: DB };

function connect(): DB {
  const existing = globalForDb.__watchmanDb;
  if (existing) return existing;

  const created = create();
  // Cached in production too: without it, the lazy proxy below would open a fresh
  // handle and re-run migrations on every property access.
  globalForDb.__watchmanDb = created;
  return created;
}

/**
 * The database handle, connected on first actual use rather than at import.
 *
 * The laziness is load-bearing, not a micro-optimisation. `next build` collects page
 * data with several parallel worker processes, and each one imports this module
 * transitively through the route tree. With an eager singleton, all of them opened the
 * same SQLite file and raced to apply migrations — one would win and the rest would
 * die on `table already exists`. Connecting on demand means a build, which never
 * issues a query, never touches the database at all.
 *
 * This is the same principle as the lazily-resolved WATCHMAN_SECRET in lib/env: a
 * build must not require runtime state.
 */
/**
 * Property probes that must never open a connection.
 *
 * Runtime plumbing inspects unfamiliar objects constantly: `await` looks for `then`,
 * JSON serialisers look for `toJSON`, React and the RSC payload writer look for
 * `$$typeof`, and node's inspector looks for its own symbol. Each of those is a plain
 * property read, so without this list Next's static-generation pass opens SQLite just
 * by asking the module "are you a promise?" — which is precisely what it was doing.
 */
const PROBE_KEYS: ReadonlySet<string | symbol> = new Set<string | symbol>([
  "then",
  "catch",
  "finally",
  "toJSON",
  "$$typeof",
  Symbol.toPrimitive,
  Symbol.toStringTag,
  Symbol.iterator,
  Symbol.asyncIterator,
  Symbol.for("nodejs.util.inspect.custom"),
]);

export const db: DB = new Proxy({} as DB, {
  get(_target, prop) {
    if (PROBE_KEYS.has(prop)) return undefined;

    const real = connect() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    // Drizzle's methods rely on `this`, so hand back a bound copy rather than a
    // detached function reference.
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(real)
      : value;
  },
  has(_target, prop) {
    if (PROBE_KEYS.has(prop)) return false;
    return prop in (connect() as unknown as object);
  },
});

/**
 * Force the connection open and apply migrations now.
 *
 * Called from instrumentation.ts so a misconfigured or unwritable volume fails loudly
 * at container start, rather than on whichever request happens to query first.
 */
export function initDb(): DB {
  return connect();
}

export { schema };
export * from "./schema";
