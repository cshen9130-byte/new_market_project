import { execFile } from "child_process"
import { existsSync } from "fs"
import path from "path"
import { promisify } from "util"
import { fmtIso, n, query, rawQuery } from "@/lib/db"
import { loadProjectEnvFiles } from "@/lib/server/load-project-env"
import { SECTOR_CROWDING_BOARDS, type SectorBoardType } from "@/lib/server/ashare-sector-crowding"

const execFileAsync = promisify(execFile)

type PythonInvocation = { executable: string; prefixArgs: string[] }

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
      // next
    }
  }
  throw new Error("Python with akshare not found")
}

async function ensureTable(): Promise<void> {
  await rawQuery(`
    CREATE TABLE IF NOT EXISTS derived_ashare_sector_fund_flow_daily (
      trade_date   DATE         NOT NULL,
      board_type   VARCHAR(20)  NOT NULL,
      board_name   VARCHAR(100) NOT NULL,
      inflow       NUMERIC(20,4),
      outflow      NUMERIC(20,4),
      net_flow     NUMERIC(20,4),
      change_pct   NUMERIC(10,4),
      source       VARCHAR(60),
      fetched_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      PRIMARY KEY (trade_date, board_type, board_name)
    )
  `)
  await rawQuery(`
    CREATE INDEX IF NOT EXISTS derived_ashare_sector_fund_flow_daily_lookup_idx
      ON derived_ashare_sector_fund_flow_daily (board_type, board_name, trade_date DESC)
  `)
}

type FlowCache = { inflight: Promise<void> | null; lastAt: number }

function getFlowCache(): FlowCache {
  const g = globalThis as typeof globalThis & { __ashareSectorFundFlowCache?: FlowCache }
  if (!g.__ashareSectorFundFlowCache) {
    g.__ashareSectorFundFlowCache = { inflight: null, lastAt: 0 }
  }
  return g.__ashareSectorFundFlowCache
}

async function runPython(script: string, args: string[], timeoutMs: number): Promise<Record<string, unknown>> {
  loadProjectEnvFiles()
  const { executable, prefixArgs } = await findPython()
  const scriptPath = path.join(process.cwd(), "scripts", "ma", script)
  const env = {
    ...process.env,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    TQDM_DISABLE: "1",
  }
  const { stdout, stderr } = await execFileAsync(executable, [...prefixArgs, scriptPath, ...args], {
    cwd: process.cwd(),
    env,
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  })
  if (stderr?.trim()) console.warn(`[sector-fund-flow] ${script} stderr:`, stderr.trim().slice(-1500))
  const text = (stdout || "").trim()
  const first = text.indexOf("{")
  const last = text.lastIndexOf("}")
  if (first < 0 || last <= first) throw new Error(`${script}: no JSON stdout`)
  return JSON.parse(text.slice(first, last + 1)) as Record<string, unknown>
}

async function persistLiveSnapshot(payload: {
  trade_date?: string
  source?: Record<string, string>
  industry?: Array<Record<string, unknown>>
  concept?: Array<Record<string, unknown>>
}): Promise<number> {
  let tradeDate = (payload.trade_date || new Date().toISOString().slice(0, 10)).slice(0, 10)
  try {
    const latest = await query<{ trade_date: Date | string }>(
      `SELECT MAX(trade_date) AS trade_date FROM raw_ashare_daily`,
    )
    const maxDate = latest[0]?.trade_date ? fmtIso(latest[0].trade_date) : null
    if (maxDate && tradeDate > maxDate) tradeDate = maxDate
  } catch {
    // ignore
  }

  const sources = payload.source || {}
  let nRows = 0
  const seen = new Set<string>()
  for (const boardType of ["industry", "concept"] as const) {
    const src = sources[boardType] || `ths_fund_flow_${boardType}_spot`
    for (const item of payload[boardType] || []) {
      const name = String(item.name || "").trim().slice(0, 100)
      const net = n(item.net_flow)
      if (!name || net == null) continue
      const key = `${boardType}:${name}`
      if (seen.has(key)) continue
      seen.add(key)
      await rawQuery(
        `INSERT INTO derived_ashare_sector_fund_flow_daily (
           trade_date, board_type, board_name, inflow, outflow, net_flow, change_pct, source, fetched_at
         ) VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (trade_date, board_type, board_name) DO UPDATE
           SET inflow = EXCLUDED.inflow,
               outflow = EXCLUDED.outflow,
               net_flow = EXCLUDED.net_flow,
               change_pct = EXCLUDED.change_pct,
               source = EXCLUDED.source,
               fetched_at = NOW()`,
        [
          tradeDate,
          boardType,
          name,
          n(item.inflow),
          n(item.outflow),
          net,
          n(item.change_pct),
          String(src).slice(0, 60),
        ],
      )
      nRows += 1
    }
  }
  return nRows
}

async function ensureData(days: number): Promise<{ refreshed: boolean; note: string | null }> {
  await ensureTable()
  const coverage = await query<{ n: string | number }>(
    `SELECT COUNT(DISTINCT trade_date) AS n
     FROM derived_ashare_sector_fund_flow_daily
     WHERE board_type = 'industry'
       AND trade_date >= CURRENT_DATE - ($1 || ' days')::interval`,
    [days],
  )
  const dates = Number(coverage[0]?.n ?? 0)
  let note: string | null = null
  let refreshed = false

  const cache = getFlowCache()
  const needProxy = dates < Math.min(40, Math.floor(days * 0.25))
  const latestLive = await query<{ n: string | number }>(
    `SELECT COUNT(*) AS n
     FROM derived_ashare_sector_fund_flow_daily
     WHERE trade_date = (SELECT MAX(trade_date) FROM raw_ashare_daily)
       AND source LIKE '%fund_flow%spot%'
       AND fetched_at > NOW() - INTERVAL '2 hours'`,
  )
  const needLive = Number(latestLive[0]?.n ?? 0) < 30

  if ((needProxy || needLive) && !cache.inflight && Date.now() - cache.lastAt > 5 * 60_000) {
    cache.lastAt = Date.now()
    cache.inflight = (async () => {
      if (needLive) {
        const live = await runPython("fetch_ashare_sector_fund_flow.py", [], 120_000)
        if (live.error) throw new Error(String(live.error))
        await persistLiveSnapshot(live as Parameters<typeof persistLiveSnapshot>[0])
      }
      if (needProxy) {
        const proxy = await runPython(
          "backfill_ashare_sector_fund_flow_proxy.py",
          ["--days", String(Math.max(days, 120))],
          300_000,
        )
        if (proxy.error) throw new Error(String(proxy.error))
      }
    })()
      .catch((e) => {
        console.error("[sector-fund-flow] refresh failed:", e)
        throw e
      })
      .finally(() => {
        cache.inflight = null
      })
  }

  if (cache.inflight) {
    try {
      await cache.inflight
      refreshed = true
    } catch (e) {
      note = e instanceof Error ? e.message : "资金流向刷新失败"
    }
  }

  if (!note) {
    note =
      "存量资金 = 窗口内每日净流入累计。历史段优先用「成交额×涨跌幅」代理；有同花顺即时净额的交易日用真实净额覆盖。"
  }
  return { refreshed, note }
}

export type SectorFundFlowBoard = {
  name: string
  latest_net: number | null
  cum_net: number | null
  latest_share_pct: number | null
  latest_roll5: number | null
  latest_roll20: number | null
  hot_days_inflow: number
  /** Cumulative net flow (存量). */
  series: Array<number | null>
  daily_net: Array<number | null>
  /** sector_net / Σ|all sector nets| × 100 */
  share_pct: Array<number | null>
  roll5: Array<number | null>
  roll20: Array<number | null>
}

function rollingSum(values: Array<number | null>, window: number): Array<number | null> {
  return values.map((_, i) => {
    if (i < window - 1) return null
    let sum = 0
    let nValid = 0
    for (let j = i - window + 1; j <= i; j++) {
      const v = values[j]
      if (v == null) continue
      sum += v
      nValid += 1
    }
    if (nValid < Math.ceil(window * 0.6)) return null
    return Number(sum.toFixed(4))
  })
}

export async function getAshareSectorFundFlow(options?: {
  boardType?: SectorBoardType | string | null
  days?: number
  limit?: number
  /** Prefer curated AI basket lines instead of top-by-cum. */
  preset?: "ai" | "top" | string | null
  /** Focus board for crowding overlay / primary rolling line. */
  focus?: string | null
}): Promise<{
  board_type: SectorBoardType
  days: number
  unit: "yi"
  start_date: string | null
  end_date: string | null
  dates: string[]
  boards: SectorFundFlowBoard[]
  latest_bars: Array<{ name: string; net_flow: number; change_pct: number | null }>
  crowding: Array<number | null>
  focus: string | null
  refreshed: boolean
  note: string | null
  preset: string
}> {
  const boardType: SectorBoardType = options?.boardType === "concept" ? "concept" : "industry"
  const days = Math.min(400, Math.max(20, options?.days ?? 120))
  const limit = Math.min(20, Math.max(3, options?.limit ?? 8))
  const preset = options?.preset === "ai" ? "ai" : "top"
  const focusOpt = (options?.focus || "").trim()

  const { refreshed, note: baseNote } = await ensureData(days)
  let note = baseNote

  const dateRows = await query<{ trade_date: Date | string }>(
    `SELECT DISTINCT trade_date
     FROM derived_ashare_sector_fund_flow_daily
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
      unit: "yi",
      start_date: null,
      end_date: null,
      dates: [],
      boards: [],
      latest_bars: [],
      crowding: [],
      focus: null,
      refreshed,
      note: note || "暂无资金流向数据",
      preset,
    }
  }

  const rows = await query<{
    trade_date: Date | string
    board_name: string
    net_flow: string | number | null
    change_pct: string | number | null
  }>(
    `SELECT trade_date, board_name, net_flow, change_pct
     FROM derived_ashare_sector_fund_flow_daily
     WHERE board_type = $1
       AND trade_date = ANY($2::date[])
     ORDER BY trade_date ASC`,
    [boardType, dates],
  )

  const dateIndex = new Map(dates.map((d, i) => [d, i]))
  const byName = new Map<string, { nets: Array<number | null>; changes: Array<number | null> }>()

  for (const r of rows) {
    const name = r.board_name?.trim()
    if (!name) continue
    let entry = byName.get(name)
    if (!entry) {
      entry = {
        nets: Array(dates.length).fill(null),
        changes: Array(dates.length).fill(null),
      }
      byName.set(name, entry)
    }
    const idx = dateIndex.get(fmtIso(r.trade_date))
    if (idx == null) continue
    entry.nets[idx] = n(r.net_flow)
    entry.changes[idx] = n(r.change_pct)
  }

  // Daily market abs-flow denominator across the full universe of this board_type.
  const marketAbs = Array(dates.length).fill(0) as number[]
  for (const entry of byName.values()) {
    entry.nets.forEach((v, i) => {
      if (v != null) marketAbs[i] += Math.abs(v)
    })
  }

  const boardsAll: SectorFundFlowBoard[] = []
  for (const [name, entry] of byName) {
    let cum = 0
    const cumSeries: Array<number | null> = []
    const sharePct: Array<number | null> = []
    let latestNet: number | null = null
    let inflowDays = 0
    for (let i = 0; i < entry.nets.length; i++) {
      const v = entry.nets[i]
      if (v == null) {
        cumSeries.push(cumSeries.length ? cumSeries[cumSeries.length - 1] : 0)
        sharePct.push(null)
        continue
      }
      cum += v
      cumSeries.push(Number(cum.toFixed(4)))
      latestNet = v
      if (v > 0) inflowDays += 1
      const denom = marketAbs[i]
      sharePct.push(denom > 0 ? Number(((v / denom) * 100).toFixed(3)) : null)
    }
    const roll5 = rollingSum(entry.nets, 5)
    const roll20 = rollingSum(entry.nets, 20)
    boardsAll.push({
      name,
      latest_net: latestNet,
      cum_net: cumSeries.length ? cumSeries[cumSeries.length - 1] : null,
      latest_share_pct: sharePct[sharePct.length - 1] ?? null,
      latest_roll5: roll5[roll5.length - 1] ?? null,
      latest_roll20: roll20[roll20.length - 1] ?? null,
      hot_days_inflow: inflowDays,
      series: cumSeries,
      daily_net: entry.nets,
      share_pct: sharePct,
      roll5,
      roll20,
    })
  }

  let selected: SectorFundFlowBoard[]
  if (preset === "ai") {
    const wanted = SECTOR_CROWDING_BOARDS.filter((b) => b.type === boardType).map((b) => b.name)
    selected = wanted
      .map((name) => boardsAll.find((b) => b.name === name))
      .filter((b): b is SectorFundFlowBoard => !!b)
    if (selected.length < Math.min(5, limit)) {
      const extras = [...boardsAll]
        .sort((a, b) => (b.cum_net ?? -Infinity) - (a.cum_net ?? -Infinity))
        .filter((b) => !selected.some((s) => s.name === b.name))
      selected = [...selected, ...extras].slice(0, limit)
    } else {
      selected = selected.slice(0, limit)
    }
  } else {
    selected = [...boardsAll]
      .sort((a, b) => Math.abs(b.cum_net ?? 0) - Math.abs(a.cum_net ?? 0))
      .slice(0, limit)
  }

  const latest_bars = [...boardsAll]
    .map((b) => ({
      name: b.name,
      net_flow: b.latest_net ?? 0,
      change_pct: byName.get(b.name)?.changes[dates.length - 1] ?? null,
    }))
    .sort((a, b) => b.net_flow - a.net_flow)
    .slice(0, 15)

  const focus =
    (focusOpt && selected.find((b) => b.name === focusOpt)?.name) ||
    selected.find((b) => b.name === "人工智能" || b.name === "半导体")?.name ||
    selected[0]?.name ||
    null

  const crowdingRows = await query<{
    trade_date: Date | string
    crowding_smooth: string | number | null
    crowding_pct: string | number | null
  }>(
    `SELECT trade_date, crowding_smooth, crowding_pct
     FROM derived_ashare_crowding_daily
     WHERE trade_date = ANY($1::date[])
     ORDER BY trade_date ASC`,
    [dates],
  )
  const crowdingByDate = new Map(
    crowdingRows.map((r) => [
      fmtIso(r.trade_date),
      n(r.crowding_smooth) ?? n(r.crowding_pct),
    ]),
  )
  const crowding = dates.map((d) => crowdingByDate.get(d) ?? null)

  if (!note) {
    note =
      "存量=窗口累计净流入；占比=板块净流入/Σ|全市场同口径板块净流入|；滚动=5/20日净流入合计。历史多为成交额×涨跌幅代理，当日有同花顺即时净额时覆盖。"
  }

  return {
    board_type: boardType,
    days,
    unit: "yi",
    start_date: dates[0] ?? null,
    end_date: dates[dates.length - 1] ?? null,
    dates,
    boards: selected,
    latest_bars,
    crowding,
    focus,
    refreshed,
    note,
    preset,
  }
}
