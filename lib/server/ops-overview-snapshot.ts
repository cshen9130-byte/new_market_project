/**
 * Last computed 数据概览 payload. A button reads this and returns immediately.
 * A stale snapshot is refreshed in the background, one key at a time.
 */

import { query } from "@/lib/db"
import { getListResponseCache, setListResponseCache } from "@/lib/server/list-response-cache"

const FRESH_MS = 3 * 60 * 1000

type SnapshotRow = { payload: unknown; updated_ms: string | number }

let tableReady: Promise<void> | null = null
const refreshing = new Set<string>()
const refreshQueue: Array<() => Promise<void>> = []
let refreshPump: Promise<void> | null = null

function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = query(
      `CREATE TABLE IF NOT EXISTS ops_overview_snapshot (
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

async function readSnapshot<T>(key: string): Promise<{ body: T; updatedAt: number } | null> {
  await ensureTable()
  const rows = await query<SnapshotRow>(
    `SELECT payload, (EXTRACT(EPOCH FROM updated_at) * 1000)::bigint AS updated_ms
     FROM ops_overview_snapshot
     WHERE cache_key = $1`,
    [key],
  )
  const row = rows[0]
  if (!row) return null
  const updatedAt = Number(row.updated_ms)
  return {
    body: row.payload as T,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
  }
}

async function writeSnapshot(key: string, body: unknown): Promise<void> {
  await ensureTable()
  await query(
    `INSERT INTO ops_overview_snapshot (cache_key, payload, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (cache_key) DO UPDATE
       SET payload = EXCLUDED.payload, updated_at = now()`,
    [key, JSON.stringify(body)],
  )
}

function pumpRefresh(): void {
  if (refreshPump) return
  refreshPump = (async () => {
    while (refreshQueue.length > 0) {
      const job = refreshQueue.shift()
      if (!job) continue
      try {
        await job()
      } catch (err) {
        console.error("[ops-snapshot] background refresh failed:", err)
      }
    }
  })().finally(() => {
    refreshPump = null
    if (refreshQueue.length > 0) pumpRefresh()
  })
}

function scheduleRefresh<T>(key: string, build: () => Promise<T>): void {
  if (refreshing.has(key)) return
  refreshing.add(key)
  refreshQueue.push(async () => {
    try {
      const snap = await readSnapshot<T>(key)
      if (snap && Date.now() - snap.updatedAt <= FRESH_MS) return
      const body = await build()
      setListResponseCache(key, body)
      await writeSnapshot(key, body)
    } finally {
      refreshing.delete(key)
    }
  })
  pumpRefresh()
}

/** Return the saved payload immediately. Rebuild only when it is missing or the caller asked to refresh. */
export async function serveOpsSnapshot<T>(
  key: string,
  refresh: boolean,
  build: () => Promise<T>,
): Promise<T> {
  if (!refresh) {
    const mem = getListResponseCache(key)
    if (mem) return mem as T
    try {
      const snap = await readSnapshot<T>(key)
      if (snap) {
        setListResponseCache(key, snap.body)
        if (Date.now() - snap.updatedAt > FRESH_MS) scheduleRefresh(key, build)
        return snap.body
      }
    } catch (err) {
      console.error("[ops-snapshot] read failed:", err)
    }
  }

  const body = await build()
  setListResponseCache(key, body)
  try {
    await writeSnapshot(key, body)
  } catch (err) {
    console.error("[ops-snapshot] write failed:", err)
  }
  return body
}
