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

export const db: DB = globalForDb.__watchmanDb ?? create();

if (!env.isProd) globalForDb.__watchmanDb = db;

export { schema };
export * from "./schema";
