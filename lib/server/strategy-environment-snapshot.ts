/**
 * Stored strategy-environment scoreboard and peer curves.
 * The page reads these rows. The daily job is what recalculates them.
 */

import { query } from "@/lib/db"

type SnapshotRow = { payload: unknown; updated_ms: string | number }

let tableReady: Promise<void> | null = null

function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = query(
      `CREATE TABLE IF NOT EXISTS strategy_environment_snapshot (
         cache_key text PRIMARY KEY,
         payload jsonb NOT NULL,
         updated_at timestamptz NOT NULL DEFAULT now()
       )`,
    ).then(() => undefined).catch((err) => {
      tableReady = null
      throw err
    })
  }
  return tableReady
}

export async function readStrategySnapshot<T>(key: string): Promise<{ body: T; updatedAt: number } | null> {
  try {
    await ensureTable()
    const rows = await query<SnapshotRow>(
      `SELECT payload, (EXTRACT(EPOCH FROM updated_at) * 1000)::bigint AS updated_ms
       FROM strategy_environment_snapshot
       WHERE cache_key = $1`,
      [key],
    )
    const row = rows[0]
    if (!row || row.payload == null) return null
    const updatedAt = Number(row.updated_ms)
    return { body: row.payload as T, updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0 }
  } catch (err) {
    console.error("[strategy-environment] snapshot read", err)
    return null
  }
}

export async function writeStrategySnapshot(key: string, body: unknown): Promise<void> {
  await ensureTable()
  await query(
    `INSERT INTO strategy_environment_snapshot (cache_key, payload, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (cache_key) DO UPDATE
       SET payload = EXCLUDED.payload, updated_at = now()`,
    [key, JSON.stringify(body)],
  )
}
