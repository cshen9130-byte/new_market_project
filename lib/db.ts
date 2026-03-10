import { Pool } from "pg"

// Singleton pool — reused across Next.js hot reloads in dev and across requests in prod.
declare global {
  // eslint-disable-next-line no-var
  var _pgPool: Pool | undefined
}

function makePool(): Pool {
  const url = process.env.DATABASE_URL
  if (url) return new Pool({ connectionString: url })
  return new Pool({
    host:     process.env.DB_HOST     || "localhost",
    port:     parseInt(process.env.DB_PORT || "5432"),
    database: process.env.DB_NAME     || "market_data",
    user:     process.env.DB_USER     || "market_user",
    password: process.env.DB_PASSWORD || "",
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

/** Format a pg DATE value (returned as JS Date at UTC midnight) to YYYY-MM-DD */
export function fmtIso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Format a pg DATE value to YYYYMMDD */
export function fmtYmd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "")
}

/** pg returns NUMERIC columns as strings; parse to number or null safely */
export function n(v: unknown): number | null {
  if (v == null) return null
  const f = parseFloat(v as string)
  return isFinite(f) ? f : null
}
