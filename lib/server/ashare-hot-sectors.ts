import { execFile } from "child_process"
import { existsSync } from "fs"
import path from "path"
import { promisify } from "util"
import { fmtIso, n, query, rawQuery } from "@/lib/db"
import { loadProjectEnvFiles } from "@/lib/server/load-project-env"

const execFileAsync = promisify(execFile)

export type HotSectorBoardType = "industry" | "concept"

export type HotSectorItem = {
  name: string
  change_pct: number | null
  amount: number | null
  lead_stock: string | null
  lead_change_pct: number | null
  rank: number | null
}

type PythonInvocation = {
  executable: string
  prefixArgs: string[]
}

type CacheState = {
  inflight: Promise<void> | null
  lastFetchAt: number
}

function getCache(): CacheState {
  const g = globalThis as typeof globalThis & { __ashareHotSectorsCache?: CacheState }
  if (!g.__ashareHotSectorsCache) {
    g.__ashareHotSectorsCache = { inflight: null, lastFetchAt: 0 }
  }
  return g.__ashareHotSectorsCache
}

function pushPythonCandidate(out: PythonInvocation[], executable: string, prefixArgs: string[] = []) {
  if (!executable || (executable.includes(path.sep) && !existsSync(executable))) return
  if (out.some((item) => item.executable === executable && item.prefixArgs.join(" ") === prefixArgs.join(" "))) {
    return
  }
  out.push({ executable, prefixArgs })
}

function listPythonCandidates(): PythonInvocation[] {
  const cwd = process.cwd()
  const out: PythonInvocation[] = []
  for (const key of ["PYTHON_EXE", "PYTHON_EXECUTABLE"] as const) {
    pushPythonCandidate(out, process.env[key] ?? "")
  }
  if (process.platform === "win32") {
    pushPythonCandidate(out, path.join(cwd, ".venv", "Scripts", "python.exe"))
    pushPythonCandidate(out, "py", ["-3"])
  } else {
    pushPythonCandidate(out, path.join(cwd, ".venv", "bin", "python3"))
    pushPythonCandidate(out, path.join(cwd, ".venv", "bin", "python"))
    pushPythonCandidate(out, "python3")
  }
  return out
}

async function findPython(): Promise<PythonInvocation> {
  for (const candidate of listPythonCandidates()) {
    try {
      await execFileAsync(
        candidate.executable,
        [...candidate.prefixArgs, "-c", "import akshare"],
        { timeout: 15_000 },
      )
      return candidate
    } catch {
      // try next
    }
  }
  throw new Error("Python with akshare not found. Run: pip install -r scripts/ma/requirements.txt")
}

async function ensureTable(): Promise<void> {
  await rawQuery(`
    CREATE TABLE IF NOT EXISTS derived_ashare_hot_sectors_daily (
      trade_date       DATE         NOT NULL,
      board_type       VARCHAR(20)  NOT NULL,
      board_name       VARCHAR(100) NOT NULL,
      change_pct       NUMERIC(10,4),
      amount           NUMERIC(20,2),
      lead_stock       VARCHAR(100),
      lead_change_pct  NUMERIC(10,4),
      rank_no          INTEGER,
      source           VARCHAR(60),
      fetched_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      PRIMARY KEY (trade_date, board_type, board_name)
    )
  `)
  await rawQuery(`
    CREATE INDEX IF NOT EXISTS derived_ashare_hot_sectors_daily_lookup_idx
      ON derived_ashare_hot_sectors_daily (trade_date DESC, board_type, rank_no)
  `)
}

type DbRow = {
  trade_date: Date | string
  board_type: string
  board_name: string
  change_pct: string | number | null
  amount: string | number | null
  lead_stock: string | null
  lead_change_pct: string | number | null
  rank_no: number | null
  source: string | null
  fetched_at: Date | string | null
}

async function readLatest(top: number): Promise<{
  trade_date: string | null
  fetched_at: string | null
  source: Record<string, string>
  industry: HotSectorItem[]
  concept: HotSectorItem[]
} | null> {
  const dateRow = await query<{ trade_date: Date | string }>(
    `SELECT trade_date
     FROM derived_ashare_hot_sectors_daily
     ORDER BY trade_date DESC
     LIMIT 1`,
  )
  if (!dateRow.length) return null
  const tradeDate = fmtIso(dateRow[0].trade_date)

  const rows = await query<DbRow>(
    `SELECT trade_date, board_type, board_name, change_pct, amount,
            lead_stock, lead_change_pct, rank_no, source, fetched_at
     FROM derived_ashare_hot_sectors_daily
     WHERE trade_date = $1::date
     ORDER BY board_type, COALESCE(rank_no, 9999), change_pct DESC NULLS LAST`,
    [tradeDate],
  )
  if (!rows.length) return null

  const source: Record<string, string> = {}
  const industry: HotSectorItem[] = []
  const concept: HotSectorItem[] = []
  let fetchedAt: string | null = null

  for (const r of rows) {
    if (r.source && !source[r.board_type]) source[r.board_type] = r.source
    if (r.fetched_at && !fetchedAt) {
      fetchedAt =
        typeof r.fetched_at === "string"
          ? r.fetched_at
          : r.fetched_at.toISOString()
    }
    const item: HotSectorItem = {
      name: r.board_name,
      change_pct: n(r.change_pct),
      amount: n(r.amount),
      lead_stock: r.lead_stock?.trim() || null,
      lead_change_pct: n(r.lead_change_pct),
      rank: r.rank_no,
    }
    if (r.board_type === "industry") industry.push(item)
    else if (r.board_type === "concept") concept.push(item)
  }

  return {
    trade_date: tradeDate,
    fetched_at: fetchedAt,
    source,
    industry: industry.slice(0, top),
    concept: concept.slice(0, top),
  }
}

async function resolveTradeDate(preferred?: string): Promise<string> {
  const fallback = (preferred || new Date().toISOString().slice(0, 10)).slice(0, 10)
  try {
    const rows = await query<{ trade_date: Date | string }>(
      `SELECT MAX(trade_date) AS trade_date FROM raw_ashare_daily`,
    )
    const latest = rows[0]?.trade_date ? fmtIso(rows[0].trade_date) : null
    if (latest && fallback > latest) return latest
  } catch {
    // ignore — use preferred/calendar date
  }
  return fallback
}

async function persistFetchPayload(payload: {
  trade_date?: string
  source?: Record<string, string>
  industry?: Array<Record<string, unknown>>
  concept?: Array<Record<string, unknown>>
}): Promise<void> {
  const tradeDate = await resolveTradeDate(payload.trade_date)
  const sources = payload.source || {}
  const records: Array<[string, string, string, number | null, number | null, string | null, number | null, number | null, string | null]> = []

  for (const boardType of ["industry", "concept"] as const) {
    const src = sources[boardType] ?? null
    for (const item of payload[boardType] || []) {
      const name = String(item.name || "").trim()
      if (!name) continue
      records.push([
        tradeDate,
        boardType,
        name.slice(0, 100),
        n(item.change_pct),
        n(item.amount),
        item.lead_stock != null ? String(item.lead_stock).slice(0, 100) : null,
        n(item.lead_change_pct),
        typeof item.rank === "number" ? item.rank : n(item.rank),
        src ? String(src).slice(0, 60) : null,
      ])
    }
  }
  if (!records.length) throw new Error("hot sectors fetch returned no rows")

  await rawQuery(
    "DELETE FROM derived_ashare_hot_sectors_daily WHERE trade_date = $1::date",
    [tradeDate],
  )

  for (const r of records) {
    await rawQuery(
      `INSERT INTO derived_ashare_hot_sectors_daily (
         trade_date, board_type, board_name, change_pct, amount,
         lead_stock, lead_change_pct, rank_no, source, fetched_at
       ) VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (trade_date, board_type, board_name) DO UPDATE
         SET change_pct = EXCLUDED.change_pct,
             amount = EXCLUDED.amount,
             lead_stock = EXCLUDED.lead_stock,
             lead_change_pct = EXCLUDED.lead_change_pct,
             rank_no = EXCLUDED.rank_no,
             source = EXCLUDED.source,
             fetched_at = NOW()`,
      r,
    )
  }
}

async function runFetchScript(): Promise<void> {
  loadProjectEnvFiles()
  const { executable, prefixArgs } = await findPython()
  const scriptPath = path.join(process.cwd(), "scripts", "ma", "fetch_ashare_hot_sectors.py")
  const env = {
    ...process.env,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    TQDM_DISABLE: "1",
  }
  const { stdout, stderr } = await execFileAsync(
    executable,
    [...prefixArgs, scriptPath, "--top", "100"],
    {
      cwd: process.cwd(),
      env,
      timeout: 90_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  )
  if (stderr?.trim()) {
    console.warn("[ashare-hot-sectors] stderr:", stderr.trim().slice(-1500))
  }
  const text = (stdout || "").trim()
  const first = text.indexOf("{")
  const last = text.lastIndexOf("}")
  if (first < 0 || last <= first) throw new Error("hot sectors fetch: no JSON stdout")
  const payload = JSON.parse(text.slice(first, last + 1)) as {
    error?: string
    trade_date?: string
    source?: Record<string, string>
    industry?: Array<Record<string, unknown>>
    concept?: Array<Record<string, unknown>>
  }
  if (payload.error) throw new Error(payload.error)
  await persistFetchPayload(payload)
  getCache().lastFetchAt = Date.now()
}

function isStale(fetchedAt: string | null, maxAgeMs: number): boolean {
  if (!fetchedAt) return true
  const ts = Date.parse(fetchedAt)
  if (!Number.isFinite(ts)) return true
  return Date.now() - ts > maxAgeMs
}

export async function getAshareHotSectors(options?: {
  top?: number
  forceRefresh?: boolean
  /** Refresh if snapshot older than this (default 30 min). */
  maxAgeMs?: number
}): Promise<{
  trade_date: string | null
  fetched_at: string | null
  source: Record<string, string>
  industry: HotSectorItem[]
  concept: HotSectorItem[]
  refreshed: boolean
}> {
  const top = Math.min(50, Math.max(5, options?.top ?? 15))
  const maxAgeMs = options?.maxAgeMs ?? 30 * 60 * 1000
  await ensureTable()

  let latest = await readLatest(top)
  const needsRefresh =
    options?.forceRefresh ||
    !latest ||
    !latest.industry.length ||
    !latest.concept.length ||
    isStale(latest.fetched_at, maxAgeMs)

  let refreshed = false
  if (needsRefresh) {
    const cache = getCache()
    if (!cache.inflight) {
      cache.inflight = runFetchScript()
        .catch((e) => {
          console.error("[ashare-hot-sectors] refresh failed:", e)
          throw e
        })
        .finally(() => {
          cache.inflight = null
        })
    }
    try {
      await cache.inflight
      refreshed = true
      latest = await readLatest(top)
    } catch (e) {
      if (!latest?.industry.length && !latest?.concept.length) throw e
      // Serve stale snapshot if refresh fails.
    }
  }

  if (!latest) {
    return {
      trade_date: null,
      fetched_at: null,
      source: {},
      industry: [],
      concept: [],
      refreshed,
    }
  }

  return { ...latest, refreshed }
}

export type HotSectorHistoryBoard = {
  name: string
  hot_days: number
  hot_share: number
  max_streak: number
  current_streak: number
  avg_rank: number | null
  best_rank: number | null
  avg_change_pct: number | null
  /** Rank on each session date (null = not in stored universe / missing). */
  ranks: Array<number | null>
  /** 1 if rank <= topN that day, else 0. */
  hot_flags: number[]
}

type HistCacheState = {
  inflight: Promise<{ ok: boolean; message: string }> | null
  lastAttemptAt: number
}

function getHistCache(): HistCacheState {
  const g = globalThis as typeof globalThis & { __ashareHotSectorsHistCache?: HistCacheState }
  if (!g.__ashareHotSectorsHistCache) {
    g.__ashareHotSectorsHistCache = { inflight: null, lastAttemptAt: 0 }
  }
  return g.__ashareHotSectorsHistCache
}

async function countDistinctDates(boardType: HotSectorBoardType, days: number): Promise<number> {
  const rows = await query<{ n: string | number }>(
    `SELECT COUNT(DISTINCT trade_date) AS n
     FROM derived_ashare_hot_sectors_daily
     WHERE board_type = $1
       AND trade_date >= CURRENT_DATE - ($2 || ' days')::interval`,
    [boardType, days],
  )
  return Number(rows[0]?.n ?? 0)
}

async function runHistBackfill(boardType: HotSectorBoardType, days: number): Promise<{ ok: boolean; message: string }> {
  loadProjectEnvFiles()
  const { executable, prefixArgs } = await findPython()
  const scriptPath = path.join(process.cwd(), "scripts", "ma", "backfill_ashare_hot_sectors_hist.py")
  // Concept universe is large; store top 40/day. Industry stores full ranked set.
  const storeTop = boardType === "concept" ? "40" : "0"
  const env = {
    ...process.env,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    TQDM_DISABLE: "1",
  }
  const { stdout, stderr } = await execFileAsync(
    executable,
    [
      ...prefixArgs,
      scriptPath,
      "--type",
      boardType,
      "--days",
      String(days),
      "--store-top",
      storeTop,
    ],
    {
      cwd: process.cwd(),
      env,
      timeout: boardType === "concept" ? 1_500_000 : 600_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  )
  if (stderr?.trim()) {
    console.warn("[ashare-hot-sectors-hist] stderr:", stderr.trim().slice(-2000))
  }
  const text = (stdout || "").trim()
  const first = text.indexOf("{")
  const last = text.lastIndexOf("}")
  if (first < 0 || last <= first) {
    return { ok: false, message: "hist backfill: no JSON stdout" }
  }
  const payload = JSON.parse(text.slice(first, last + 1)) as { error?: string; ok?: boolean }
  if (payload.error) return { ok: false, message: payload.error }
  return { ok: true, message: "backfilled" }
}

function streakStats(flags: number[]): { maxStreak: number; currentStreak: number } {
  let maxStreak = 0
  let run = 0
  for (const f of flags) {
    if (f === 1) {
      run += 1
      if (run > maxStreak) maxStreak = run
    } else {
      run = 0
    }
  }
  let currentStreak = 0
  for (let i = flags.length - 1; i >= 0; i--) {
    if (flags[i] === 1) currentStreak += 1
    else break
  }
  return { maxStreak, currentStreak }
}

export async function getAshareHotSectorHistory(options?: {
  boardType?: HotSectorBoardType
  days?: number
  /** A day counts as "hot" when rank_no <= topN. */
  topN?: number
  /** Return top K boards by continuity. */
  limit?: number
  /** Trigger hist backfill when coverage is thin. */
  autoBackfill?: boolean
}): Promise<{
  board_type: HotSectorBoardType
  days: number
  top_n: number
  start_date: string | null
  end_date: string | null
  session_count: number
  dates: string[]
  boards: HotSectorHistoryBoard[]
  backfilled: boolean
  coverage_note: string | null
}> {
  const boardType = options?.boardType === "concept" ? "concept" : "industry"
  const days = Math.min(180, Math.max(5, options?.days ?? 20))
  const topN = Math.min(30, Math.max(3, options?.topN ?? 10))
  const limit = Math.min(30, Math.max(5, options?.limit ?? 15))
  const autoBackfill = options?.autoBackfill !== false

  await ensureTable()

  let backfilled = false
  let coverageNote: string | null = null
  const minDates = Math.min(days, Math.max(8, Math.floor(days * 0.5)))
  const coverage = await countDistinctDates(boardType, days + 10)

  // Auto-backfill industry only ( ~90 boards). Concept hist is ~375 boards and too slow for request path.
  if (autoBackfill && boardType === "industry" && coverage < minDates) {
    const cache = getHistCache()
    const since = Date.now() - cache.lastAttemptAt
    // Avoid hammering THS if a recent attempt failed.
    if (!cache.inflight && since > 10 * 60_000) {
      cache.lastAttemptAt = Date.now()
      cache.inflight = runHistBackfill(boardType, Math.max(days, 40))
        .finally(() => {
          cache.inflight = null
        })
    }
    if (cache.inflight) {
      try {
        const result = await cache.inflight
        backfilled = result.ok
        if (!result.ok) coverageNote = `历史回填失败：${result.message}`
      } catch (e) {
        coverageNote = e instanceof Error ? e.message : "历史回填失败"
      }
    }
  } else if (boardType === "concept" && coverage < minDates) {
    coverageNote =
      "概念板块历史依赖每日快照积累；完整回填可运行 ETL：ashare_hot_sectors_hist（需 HOT_SECTORS_HIST_INCLUDE_CONCEPT=1）"
  }

  const dateRows = await query<{ trade_date: Date | string }>(
    `SELECT DISTINCT trade_date
     FROM derived_ashare_hot_sectors_daily
     WHERE board_type = $1
     ORDER BY trade_date DESC
     LIMIT $2`,
    [boardType, days],
  )
  const dates = dateRows.map((r) => fmtIso(r.trade_date)).reverse()
  if (!dates.length) {
    return {
      board_type: boardType,
      days,
      top_n: topN,
      start_date: null,
      end_date: null,
      session_count: 0,
      dates: [],
      boards: [],
      backfilled,
      coverage_note: coverageNote || "暂无历史数据，请稍后重试或运行 ETL ashare_hot_sectors_hist",
    }
  }

  const rows = await query<{
    trade_date: Date | string
    board_name: string
    change_pct: string | number | null
    rank_no: number | null
  }>(
    `SELECT trade_date, board_name, change_pct, rank_no
     FROM derived_ashare_hot_sectors_daily
     WHERE board_type = $1
       AND trade_date = ANY($2::date[])
     ORDER BY trade_date ASC, rank_no ASC NULLS LAST`,
    [boardType, dates],
  )

  const byName = new Map<
    string,
    { ranks: Array<number | null>; changes: Array<number | null> }
  >()
  const dateIndex = new Map(dates.map((d, i) => [d, i]))

  for (const r of rows) {
    const name = r.board_name?.trim()
    if (!name) continue
    let entry = byName.get(name)
    if (!entry) {
      entry = {
        ranks: Array(dates.length).fill(null),
        changes: Array(dates.length).fill(null),
      }
      byName.set(name, entry)
    }
    const idx = dateIndex.get(fmtIso(r.trade_date))
    if (idx == null) continue
    entry.ranks[idx] = r.rank_no
    entry.changes[idx] = n(r.change_pct)
  }

  const boards: HotSectorHistoryBoard[] = []
  for (const [name, entry] of byName) {
    const hotFlags = entry.ranks.map((rank) => (rank != null && rank <= topN ? 1 : 0))
    const hotDays = hotFlags.reduce((s, x) => s + x, 0)
    if (hotDays <= 0) continue
    const { maxStreak, currentStreak } = streakStats(hotFlags)
    const ranked = entry.ranks.filter((x): x is number => x != null)
    const hotChanges = entry.changes.filter(
      (chg, i) => chg != null && hotFlags[i] === 1,
    ) as number[]
    boards.push({
      name,
      hot_days: hotDays,
      hot_share: dates.length ? hotDays / dates.length : 0,
      max_streak: maxStreak,
      current_streak: currentStreak,
      avg_rank: ranked.length
        ? ranked.reduce((s, x) => s + x, 0) / ranked.length
        : null,
      best_rank: ranked.length ? Math.min(...ranked) : null,
      avg_change_pct: hotChanges.length
        ? hotChanges.reduce((s, x) => s + x, 0) / hotChanges.length
        : null,
      ranks: entry.ranks,
      hot_flags: hotFlags,
    })
  }

  boards.sort((a, b) => {
    if (b.hot_days !== a.hot_days) return b.hot_days - a.hot_days
    if (b.max_streak !== a.max_streak) return b.max_streak - a.max_streak
    if (b.current_streak !== a.current_streak) return b.current_streak - a.current_streak
    return (a.avg_rank ?? 999) - (b.avg_rank ?? 999)
  })

  if (!coverageNote && dates.length < minDates) {
    coverageNote = `历史覆盖仅 ${dates.length} 个交易日，持续性统计会随夜间回填逐渐完整`
  }

  return {
    board_type: boardType,
    days,
    top_n: topN,
    start_date: dates[0] ?? null,
    end_date: dates[dates.length - 1] ?? null,
    session_count: dates.length,
    dates,
    boards: boards.slice(0, limit),
    backfilled,
    coverage_note: coverageNote,
  }
}
