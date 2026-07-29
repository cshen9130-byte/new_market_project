import { Pool, types } from "pg"

// DATE columns (OID 1082) come back from pg as JavaScript Date objects set to local
// midnight. On UTC+8 servers this shifts every date back one day when .toISOString()
// is called. Override the parser to keep DATE values as raw "YYYY-MM-DD" strings.
types.setTypeParser(1082, (val: string) => val)

// Singleton pool — reused across Next.js hot reloads in dev and across requests in prod.
declare global {
  // eslint-disable-next-line no-var
  var _pgPool: Pool | undefined
}

function makePool(): Pool {
  // statement_timeout prevents hung queries from blocking the app indefinitely.
  // connectionTimeoutMillis limits how long we wait to acquire a pool connection.
  const sharedOpts = {
    max:                      parseInt(process.env.DB_POOL_MAX || "20", 10),
    statement_timeout:        parseInt(process.env.DB_STATEMENT_TIMEOUT || "60000", 10),
    connectionTimeoutMillis:  10_000,   // 10 s to get a connection from the pool
    idleTimeoutMillis:        30_000,
  }
  const url = process.env.DATABASE_URL
  if (url) return new Pool({ connectionString: url, ...sharedOpts })
  return new Pool({
    host:     process.env.DB_HOST     || "localhost",
    port:     parseInt(process.env.DB_PORT || "5432"),
    database: process.env.DB_NAME     || "market_data",
    user:     process.env.DB_USER     || "market_user",
    password: process.env.DB_PASSWORD || "",
    ...sharedOpts,
  })
}

const pool: Pool = global._pgPool ?? (global._pgPool = makePool())

export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const res = await pool.query(sql, params)
  return res.rows as T[]
}

/** Like query() but returns the full QueryResult (rows, fields, rowCount, command). */
export async function rawQuery(
  sql: string,
  params?: unknown[],
) {
  return pool.query(sql, params)
}

/**
 * Run a query with no statement timeout (bypasses the pool-level statement_timeout).
 * Use only for known long-running ETL queries that should not be bounded.
 */
export async function queryUnbounded<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const client = await pool.connect()
  try {
    await client.query("SET statement_timeout = 0")
    const res = await client.query(sql, params)
    return res.rows as T[]
  } finally {
    client.release()
  }
}

/** Run work in a single Postgres transaction (BEGIN / COMMIT / ROLLBACK). */
export async function withTransaction<T>(
  fn: (txQuery: typeof query) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  const txQuery = (async <R = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<R[]> => {
    const res = await client.query(sql, params)
    return res.rows as R[]
  }) as typeof query
  try {
    await client.query("BEGIN")
    const result = await fn(txQuery)
    await client.query("COMMIT")
    return result
  } catch (err) {
    try {
      await client.query("ROLLBACK")
    } catch {
      // ignore rollback errors
    }
    throw err
  } finally {
    client.release()
  }
}

/** Format a pg DATE value (string "YYYY-MM-DD" or JS Date) to "YYYY-MM-DD" */
export function fmtIso(d: Date | string): string {
  if (typeof d === "string") return d.slice(0, 10)
  return d.toISOString().slice(0, 10)
}

/** Format a pg DATE value (string "YYYY-MM-DD" or JS Date) to "YYYYMMDD" */
export function fmtYmd(d: Date | string): string {
  if (typeof d === "string") return d.slice(0, 10).replace(/-/g, "")
  return d.toISOString().slice(0, 10).replace(/-/g, "")
}

/** pg returns NUMERIC columns as strings; parse to number or null safely */
export function n(v: unknown): number | null {
  if (v == null) return null
  const f = parseFloat(v as string)
  return isFinite(f) ? f : null
}
