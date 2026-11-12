import { spawn } from "child_process"
import path from "path"
import { fmtIso, n, query, rawQuery } from "@/lib/db"
import { NATIONAL_TEAM_UNIVERSE_NOTE } from "@/lib/ma/national-team-universe"

export const NATIONAL_TEAM_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS raw_national_team_etf_daily (
  trade_date date NOT NULL,
  ts_code text NOT NULL,
  name text,
  shares numeric,
  close numeric,
  nav numeric,
  scale numeric,
  in_pool boolean NOT NULL DEFAULT false,
  source text,
  fetched_at timestamptz DEFAULT now(),
  PRIMARY KEY (trade_date, ts_code)
);
CREATE INDEX IF NOT EXISTS idx_raw_nt_etf_pool
  ON raw_national_team_etf_daily (trade_date)
  WHERE in_pool;
CREATE TABLE IF NOT EXISTS derived_national_team_daily (
  trade_date date PRIMARY KEY,
  net_flow numeric,
  scale numeric,
  scale_chg numeric,
  purchase numeric,
  redeem numeric,
  index_sh numeric,
  index_csi300 numeric,
  index_csi1000 numeric,
  pool_count integer,
  updated_at timestamptz DEFAULT now()
);
`

export type NationalTeamPoint = {
  date: string
  net_flow: number | null
  scale: number | null
  scale_chg: number | null
  scale_chg_pct: number | null
  purchase: number | null
  redeem: number | null
  index_sh: number | null
  index_csi300: number | null
  index_csi1000: number | null
  pool_count: number | null
}

export type NationalTeamSummary = {
  start: string | null
  end: string | null
  trading_days: number
  net: number | null
  purch_days: number
  redeem_days: number
  purch_sum: number | null
  redeem_sum: number | null
  abs_sum: number | null
  avg_net: number | null
  max_purch: { date: string; value: number } | null
  max_redeem: { date: string; value: number } | null
  start_scale: number | null
  end_scale: number | null
}

type DerivedRow = {
  trade_date: Date | string
  net_flow: string | number | null
  scale: string | number | null
  scale_chg: string | number | null
  purchase: string | number | null
  redeem: string | number | null
  index_sh: string | number | null
  index_csi300: string | number | null
  index_csi1000: string | number | null
  pool_count: string | number | null
}

let tablesReady = false

export async function ensureNationalTeamTables(): Promise<void> {
  if (tablesReady) return
  await rawQuery(NATIONAL_TEAM_TABLE_SQL)
  tablesReady = true
}

function yi(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null
  return v / 1e8
}

function mapPoint(r: DerivedRow, prevScale: number | null): NationalTeamPoint {
  const scale = n(r.scale)
  const scaleChg = n(r.scale_chg)
  const chg = scaleChg ?? (scale != null && prevScale != null ? scale - prevScale : null)
  const pct = chg != null && prevScale ? (chg / prevScale) * 100 : null
  return {
    date: fmtIso(r.trade_date),
    net_flow: yi(n(r.net_flow)),
    scale: yi(scale),
    scale_chg: yi(chg),
    scale_chg_pct: pct,
    purchase: yi(n(r.purchase)),
    redeem: yi(n(r.redeem)),
    index_sh: n(r.index_sh),
    index_csi300: n(r.index_csi300),
    index_csi1000: n(r.index_csi1000),
    pool_count: n(r.pool_count),
  }
}

export async function getNationalTeamBounds(): Promise<{ min: string | null; max: string | null; count: number }> {
  await ensureNationalTeamTables()
  const rows = await query<{ min: Date | string | null; max: Date | string | null; count: string | number }>(
    `SELECT MIN(trade_date) AS min, MAX(trade_date) AS max, COUNT(*) AS count
     FROM derived_national_team_daily`,
  )
  const r = rows[0]
  return {
    min: r?.min ? fmtIso(r.min) : null,
    max: r?.max ? fmtIso(r.max) : null,
    count: Number(r?.count ?? 0),
  }
}

export async function getNationalTeamSeries(start?: string, end?: string): Promise<NationalTeamPoint[]> {
  await ensureNationalTeamTables()
  const rows = await query<DerivedRow>(
    `SELECT trade_date, net_flow, scale, scale_chg, purchase, redeem,
            index_sh, index_csi300, index_csi1000, pool_count
     FROM derived_national_team_daily
     WHERE ($1::date IS NULL OR trade_date >= $1::date)
       AND ($2::date IS NULL OR trade_date <= $2::date)
     ORDER BY trade_date ASC`,
    [start || null, end || null],
  )
  let prev: number | null = null
  return rows.map((r) => {
    const pt = mapPoint(r, prev)
    prev = n(r.scale)
    return pt
  })
}

export function summarizeNationalTeam(series: NationalTeamPoint[], start?: string, end?: string): NationalTeamSummary {
  const sliced = series.filter((p) => {
    if (start && p.date < start) return false
    if (end && p.date > end) return false
    return p.net_flow != null
  })
  const empty: NationalTeamSummary = {
    start: start ?? sliced[0]?.date ?? null,
    end: end ?? sliced[sliced.length - 1]?.date ?? null,
    trading_days: 0,
    net: null,
    purch_days: 0,
    redeem_days: 0,
    purch_sum: null,
    redeem_sum: null,
    abs_sum: null,
    avg_net: null,
    max_purch: null,
    max_redeem: null,
    start_scale: null,
    end_scale: null,
  }
  if (!sliced.length) return empty

  let net = 0
  let purchSum = 0
  let redeemSum = 0
  let purchDays = 0
  let redeemDays = 0
  let maxPurch: { date: string; value: number } | null = null
  let maxRedeem: { date: string; value: number } | null = null

  for (const p of sliced) {
    const flow = p.net_flow ?? 0
    net += flow
    if (flow > 0) {
      purchDays += 1
      purchSum += flow
      if (!maxPurch || flow > maxPurch.value) maxPurch = { date: p.date, value: flow }
    } else if (flow < 0) {
      redeemDays += 1
      redeemSum += -flow
      if (!maxRedeem || -flow > maxRedeem.value) maxRedeem = { date: p.date, value: flow }
    }
  }

  const days = sliced.length
  return {
    start: sliced[0].date,
    end: sliced[sliced.length - 1].date,
    trading_days: days,
    net,
    purch_days: purchDays,
    redeem_days: redeemDays,
    purch_sum: purchSum,
    redeem_sum: redeemSum,
    abs_sum: purchSum + redeemSum,
    avg_net: days ? net / days : null,
    max_purch: maxPurch,
    max_redeem: maxRedeem,
    start_scale: sliced[0].scale,
    end_scale: sliced[sliced.length - 1].scale,
  }
}

export async function getNationalTeamPayload(options?: {
  summaryStart?: string
  summaryEnd?: string
  chartStart?: string
  chartEnd?: string
}) {
  const bounds = await getNationalTeamBounds()
  const series = await query<DerivedRow>(
    `SELECT trade_date, net_flow, scale, scale_chg, purchase, redeem,
            index_sh, index_csi300, index_csi1000, pool_count
     FROM derived_national_team_daily
     ORDER BY trade_date ASC`,
  )
  let prev: number | null = null
  const all = series.map((r) => {
    const pt = mapPoint(r, prev)
    prev = n(r.scale)
    return pt
  })

  const chart = all.filter((p) => {
    if (options?.chartStart && p.date < options.chartStart) return false
    if (options?.chartEnd && p.date > options.chartEnd) return false
    return true
  })

  const latestPool = all.length ? all[all.length - 1].pool_count : null

  return {
    bounds,
    series: chart,
    all_dates: { min: bounds.min, max: bounds.max, count: bounds.count },
    summary: summarizeNationalTeam(all, options?.summaryStart, options?.summaryEnd),
    universe: {
      count: latestPool,
      note: NATIONAL_TEAM_UNIVERSE_NOTE,
    },
    source: "exchange-etf-shares",
  }
}

export function spawnNationalTeamRefresh(args: string[] = ["--recent", "20"]): void {
  const script = path.join(process.cwd(), "scripts", "ma", "fetch_national_team_etf.py")
  const child = spawn("python", [script, ...args], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  })
  child.unref()
}
