import { fmtIso, n, query, rawQuery } from "@/lib/db"
import type { HotSectorBoardType } from "@/lib/server/ashare-hot-sectors"

export type SectorOverviewItem = {
  name: string
  change_pct: number | null
  period_return: number | null
  net_flow: number | null
  period_net: number | null
  amount: number | null
  rank: number | null
  period_rank: number | null
}

async function ensureTables(): Promise<void> {
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
}

function compoundReturn(changes: Array<number | null>): number | null {
  let acc = 1
  let nValid = 0
  for (const c of changes) {
    if (c == null) continue
    acc *= 1 + c / 100
    nValid += 1
  }
  if (nValid <= 0) return null
  return Number(((acc - 1) * 100).toFixed(3))
}

export async function getAshareSectorOverview(options?: {
  boardType?: HotSectorBoardType | string | null
  /** Lookback sessions for period return / period net flow. */
  days?: number
  sort?: "change" | "period_return" | "net_flow" | "period_net" | string | null
  /** As-of trade date (YYYY-MM-DD). Uses nearest available session on/before this date. */
  date?: string | null
}): Promise<{
  board_type: HotSectorBoardType
  days: number
  sort: string
  trade_date: string | null
  start_date: string | null
  session_count: number
  available_dates: string[]
  prev_date: string | null
  next_date: string | null
  breadth: { up: number; down: number; flat: number; total: number }
  period_breadth: { up: number; down: number; flat: number; total: number }
  boards: SectorOverviewItem[]
  note: string | null
}> {
  const boardType: HotSectorBoardType = options?.boardType === "concept" ? "concept" : "industry"
  const days = Math.min(60, Math.max(1, options?.days ?? 1))
  const sort = (options?.sort || "change") as string
  const requestedDate = (options?.date || "").trim().slice(0, 10) || null

  await ensureTables()

  // Prefer the most recent date with broad coverage (full universe, not top-N only).
  const minCoverage = boardType === "industry" ? 50 : 80

  const availableRows = await query<{ trade_date: Date | string }>(
    `SELECT trade_date
     FROM (
       SELECT trade_date, COUNT(*) AS n
       FROM (
         SELECT trade_date, board_name FROM derived_ashare_hot_sectors_daily WHERE board_type = $1
         UNION
         SELECT trade_date, board_name FROM derived_ashare_sector_fund_flow_daily WHERE board_type = $1
       ) u
       GROUP BY trade_date
       HAVING COUNT(*) >= $2
     ) d
     ORDER BY trade_date DESC
     LIMIT 400`,
    [boardType, minCoverage],
  )
  let available_dates = availableRows.map((r) => fmtIso(r.trade_date))

  // Fallback: any dates if coverage filter is too strict (e.g. early concept history).
  if (!available_dates.length) {
    const loose = await query<{ trade_date: Date | string }>(
      `SELECT DISTINCT trade_date
       FROM (
         SELECT trade_date FROM derived_ashare_hot_sectors_daily WHERE board_type = $1
         UNION
         SELECT trade_date FROM derived_ashare_sector_fund_flow_daily WHERE board_type = $1
       ) d
       ORDER BY trade_date DESC
       LIMIT 400`,
      [boardType],
    )
    available_dates = loose.map((r) => fmtIso(r.trade_date))
  }

  let tradeDate: string | null = null
  if (requestedDate) {
    // Nearest available session on or before the requested date.
    tradeDate =
      available_dates.find((d) => d <= requestedDate) ||
      [...available_dates].reverse().find((d) => d >= requestedDate) ||
      null
  }
  if (!tradeDate) {
    tradeDate = available_dates[0] ?? null
  }

  const dateIdx = tradeDate ? available_dates.indexOf(tradeDate) : -1
  // available_dates is DESC (newest first)
  const prev_date = dateIdx >= 0 && dateIdx < available_dates.length - 1 ? available_dates[dateIdx + 1] : null
  const next_date = dateIdx > 0 ? available_dates[dateIdx - 1] : null

  if (!tradeDate) {
    return {
      board_type: boardType,
      days,
      sort,
      trade_date: null,
      start_date: null,
      session_count: 0,
      available_dates: [],
      prev_date: null,
      next_date: null,
      breadth: { up: 0, down: 0, flat: 0, total: 0 },
      period_breadth: { up: 0, down: 0, flat: 0, total: 0 },
      boards: [],
      note: "暂无全市场板块数据",
    }
  }

  const dateRows = await query<{ trade_date: Date | string }>(
    `SELECT DISTINCT trade_date
     FROM (
       SELECT trade_date FROM derived_ashare_hot_sectors_daily WHERE board_type = $1 AND trade_date <= $2::date
       UNION
       SELECT trade_date FROM derived_ashare_sector_fund_flow_daily WHERE board_type = $1 AND trade_date <= $2::date
     ) d
     ORDER BY trade_date DESC
     LIMIT $3`,
    [boardType, tradeDate, days],
  )
  const dates = dateRows.map((r) => fmtIso(r.trade_date)).reverse()
  const startDate = dates[0] ?? tradeDate

  const hotRows = await query<{
    trade_date: Date | string
    board_name: string
    change_pct: string | number | null
    amount: string | number | null
    rank_no: number | null
  }>(
    `SELECT trade_date, board_name, change_pct, amount, rank_no
     FROM derived_ashare_hot_sectors_daily
     WHERE board_type = $1
       AND trade_date = ANY($2::date[])`,
    [boardType, dates],
  )

  const flowRows = await query<{
    trade_date: Date | string
    board_name: string
    net_flow: string | number | null
    change_pct: string | number | null
  }>(
    `SELECT trade_date, board_name, net_flow, change_pct
     FROM derived_ashare_sector_fund_flow_daily
     WHERE board_type = $1
       AND trade_date = ANY($2::date[])`,
    [boardType, dates],
  )

  type Acc = {
    changes: Map<string, number | null>
    nets: Map<string, number | null>
    amount: number | null
    rank: number | null
  }
  const byName = new Map<string, Acc>()

  const ensure = (name: string): Acc => {
    let a = byName.get(name)
    if (!a) {
      a = { changes: new Map(), nets: new Map(), amount: null, rank: null }
      byName.set(name, a)
    }
    return a
  }

  for (const r of hotRows) {
    const name = r.board_name?.trim()
    if (!name) continue
    const a = ensure(name)
    const d = fmtIso(r.trade_date)
    if (!a.changes.has(d) || a.changes.get(d) == null) a.changes.set(d, n(r.change_pct))
    if (d === tradeDate) {
      a.amount = n(r.amount)
      a.rank = r.rank_no
    }
  }
  for (const r of flowRows) {
    const name = r.board_name?.trim()
    if (!name) continue
    const a = ensure(name)
    const d = fmtIso(r.trade_date)
    a.nets.set(d, n(r.net_flow))
    // Prefer flow change_pct on latest day when hot table only kept Top-N.
    if (d === tradeDate && n(r.change_pct) != null) {
      a.changes.set(d, n(r.change_pct))
    } else if (!a.changes.has(d)) {
      a.changes.set(d, n(r.change_pct))
    }
  }

  const boards: SectorOverviewItem[] = []
  for (const [name, a] of byName) {
    const changeSeries = dates.map((d) => a.changes.get(d) ?? null)
    const netSeries = dates.map((d) => a.nets.get(d) ?? null)
    const changePct = changeSeries[changeSeries.length - 1] ?? null
    const netFlow = netSeries[netSeries.length - 1] ?? null
    const periodReturn = days <= 1 ? changePct : compoundReturn(changeSeries)
    let periodNet: number | null = null
    let netSum = 0
    let netN = 0
    for (const v of netSeries) {
      if (v == null) continue
      netSum += v
      netN += 1
    }
    if (netN > 0) periodNet = Number(netSum.toFixed(4))

    // Skip names with no usable signal on the snapshot/period.
    if (changePct == null && periodReturn == null && netFlow == null && periodNet == null) continue

    boards.push({
      name,
      change_pct: changePct,
      period_return: periodReturn,
      net_flow: netFlow,
      period_net: periodNet,
      amount: a.amount,
      rank: a.rank,
      period_rank: null,
    })
  }

  const metric = (b: SectorOverviewItem): number => {
    if (sort === "period_return") return b.period_return ?? -Infinity
    if (sort === "net_flow") return b.net_flow ?? -Infinity
    if (sort === "period_net") return b.period_net ?? -Infinity
    return b.change_pct ?? -Infinity
  }
  boards.sort((a, b) => metric(b) - metric(a))
  boards.forEach((b, i) => {
    b.period_rank = i + 1
  })

  const breadthOf = (vals: Array<number | null>) => {
    let up = 0
    let down = 0
    let flat = 0
    for (const v of vals) {
      if (v == null) continue
      if (v > 0.05) up += 1
      else if (v < -0.05) down += 1
      else flat += 1
    }
    return { up, down, flat, total: up + down + flat }
  }

  const breadth = breadthOf(boards.map((b) => b.change_pct))
  const period_breadth = breadthOf(boards.map((b) => b.period_return))

  let note: string | null = null
  if (requestedDate && tradeDate && requestedDate !== tradeDate) {
    note = `所选日期无交易/无完整截面，已切换至最近可用交易日 ${tradeDate}`
  } else if (boardType === "concept" && boards.length < 100) {
    note = "概念全量主要来自最新资金流快照；区间表现依赖已落库历史，覆盖可能少于行业。"
  } else if (days > 1 && dates.length < days) {
    note = `区间仅覆盖 ${dates.length} 个交易日（请求 ${days} 日）`
  }

  return {
    board_type: boardType,
    days,
    sort,
    trade_date: tradeDate,
    start_date: startDate,
    session_count: dates.length,
    available_dates,
    prev_date,
    next_date,
    breadth,
    period_breadth,
    boards,
    note,
  }
}
