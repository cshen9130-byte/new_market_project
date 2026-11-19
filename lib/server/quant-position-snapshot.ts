/**
 * Latest-day sector exposure for 量化策略分析.
 * Reads public.mom_* and public.cfmmc_* only. Does not write either book.
 * MOM sector pnl is 持仓盈亏 + 平仓盈亏. Broker sector pnl is the change in
 * open floating pnl versus the previous position date, and does not include closes.
 */
import { publicQuery } from "@/lib/db"
import { PROD_SECTOR } from "@/lib/ma/prod-sector"
import { QUANT_STRATEGY_ACCOUNTS, accountNumericId } from "@/lib/ma/quant-accounts"
import {
  buildPositionExposure,
  isOptionContract,
  shortBookName,
  type ExposureLeg,
  type PositionExposure,
} from "@/lib/ma/quant-position-exposure"
import { pmForAccount } from "@/lib/server/account-risk-pm"
import { getPrefix } from "@/lib/server/prod-utils"

const MOM_IDS = QUANT_STRATEGY_ACCOUNTS.filter((a) => a.source === "mom").map((a) => a.id)
const CFMMC_IDS = QUANT_STRATEGY_ACCOUNTS.filter((a) => a.source === "cfmmc").map((a) => a.id)

const MOM_NORM = `COALESCE(NULLIF(REGEXP_REPLACE(REGEXP_REPLACE(TRIM("账户"::text), '[^0-9]', '', 'g'), '^0+', ''), ''), '0')`

function numExpr(col: string): string {
  return `COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("${col}"::text, ''), ',', ''), ' ', ''), '')::numeric, 0)`
}

function toNum(value: unknown): number {
  if (value == null || value === "") return 0
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""))
  return Number.isFinite(n) ? n : 0
}

function toNumOrNull(value: unknown): number | null {
  if (value == null || value === "") return null
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""))
  return Number.isFinite(n) ? n : null
}

function dayText(value: unknown): string | null {
  if (value == null) return null
  const text = String(value).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

function riskPct(value: unknown): number | null {
  if (value == null || value === "") return null
  const text = String(value).trim()
  if (!text) return null
  const hasPct = text.includes("%")
  const n = Number(text.replace(/,/g, "").replace(/%/g, ""))
  if (!Number.isFinite(n)) return null
  const pct = hasPct || Math.abs(n) > 1.5 ? n : n * 100
  return Math.round(pct * 10) / 10
}

async function q<T>(sql: string, params: unknown[]): Promise<T[]> {
  const res = await publicQuery(sql, params)
  return res.rows as T[]
}

async function qOptional<T>(sql: string, params: unknown[]): Promise<T[]> {
  try {
    return await q<T>(sql, params)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("does not exist") || msg.includes("不存在")) return []
    throw err
  }
}

type Bag = {
  long: Record<string, number>
  short: Record<string, number>
  pnl: Record<string, number>
  float: Record<string, number>
}

function bag(): Bag {
  return { long: {}, short: {}, pnl: {}, float: {} }
}

function touch(map: Map<string, Bag>, id: string): Bag {
  let row = map.get(id)
  if (!row) {
    row = bag()
    map.set(id, row)
  }
  return row
}

function add(rec: Record<string, number>, key: string, amount: number) {
  if (!amount) return
  rec[key] = (rec[key] ?? 0) + amount
}

function sectorOf(contract: string): string | null {
  if (!contract || isOptionContract(contract)) return null
  const prefix = getPrefix(contract)
  return PROD_SECTOR[prefix] ?? "其他"
}

function maxDay(values: Iterable<string>): string | null {
  let best: string | null = null
  for (const value of values) {
    if (!best || value > best) best = value
  }
  return best
}

type MomPos = { account: string; contract: string; long_mv: string; short_mv: string; pnl: string }
type MomClose = { account: string; contract: string; pnl: string }
type MomDaily = { account: string; daily_pnl: string }
type LatestRow = { account: string; latest: string | null }
type AdvisorRow = { account_code: string; advisor_name: string | null }
type CfmmcPos = { account: string; contract: string; long_mv: string; short_mv: string; floating: string }
type CfmmcDaily = {
  account: string
  equity: string | null
  daily_pnl: string | null
  risk_ratio: string | null
  client_name: string | null
}

export async function loadQuantPositionExposure(requested: string | null): Promise<PositionExposure> {
  const [momLatestRows, cfmmcLatestRows, advisorRows, nameRows] = await Promise.all([
    q<LatestRow>(
      `SELECT ${MOM_NORM} AS account, MAX("交易日期")::text AS latest
       FROM public.mom_position_details
       WHERE ${MOM_NORM} = ANY($1::text[])
       GROUP BY 1`,
      [MOM_IDS],
    ),
    qOptional<LatestRow>(
      `SELECT TRIM(account_no) AS account, MAX(trade_date)::text AS latest
       FROM public.cfmmc_positions
       WHERE TRIM(account_no) = ANY($1::text[])
       GROUP BY TRIM(account_no)`,
      [CFMMC_IDS],
    ),
    qOptional<AdvisorRow>(
      `SELECT account_code, advisor_name FROM public.mom_advisor_info`,
      [],
    ),
    qOptional<{ account: string; client_name: string | null }>(
      `SELECT DISTINCT ON (TRIM(account_no))
         TRIM(account_no) AS account,
         NULLIF(TRIM(client_name), '') AS client_name
       FROM public.cfmmc_daily_summary
       WHERE TRIM(account_no) = ANY($1::text[])
       ORDER BY TRIM(account_no), trade_date DESC`,
      [CFMMC_IDS],
    ),
  ])

  const momLatest = new Map<string, string>()
  for (const row of momLatestRows) {
    const day = dayText(row.latest)
    if (row.account && day) momLatest.set(row.account, day)
  }
  const cfmmcLatest = new Map<string, string>()
  for (const row of cfmmcLatestRows) {
    const day = dayText(row.latest)
    if (row.account && day) cfmmcLatest.set(row.account, day)
  }
  const bookDate = requested ?? maxDay(momLatest.values()) ?? maxDay(cfmmcLatest.values())
  if (!bookDate) return buildPositionExposure({ date: null, accounts: [] })

  const advisors = new Map<string, string>()
  for (const row of advisorRows) {
    const id = accountNumericId(row.account_code ?? "")
    const name = (row.advisor_name ?? "").trim()
    if (id && name && !advisors.has(id)) advisors.set(id, name)
  }
  const brokerNames = new Map<string, string>()
  for (const row of nameRows) {
    const name = (row.client_name ?? "").trim()
    if (row.account && name) brokerNames.set(row.account, name)
  }

  const [momPos, momClose, momDailyRows, cfmmcPos, cfmmcPrev, cfmmcDailyRows] = await Promise.all([
    q<MomPos>(
      `SELECT ${MOM_NORM} AS account,
              UPPER(TRIM("合约")) AS contract,
              SUM(CASE WHEN ${numExpr("买持仓")} > 0 THEN ${numExpr("持仓市値")} ELSE 0 END)::text AS long_mv,
              SUM(CASE WHEN ${numExpr("卖持仓")} > 0 THEN ${numExpr("持仓市値")} ELSE 0 END)::text AS short_mv,
              SUM(${numExpr("持仓盈亏")})::text AS pnl
       FROM public.mom_position_details
       WHERE "交易日期" = $1::date
         AND ${MOM_NORM} = ANY($2::text[])
         AND "合约" IS NOT NULL
       GROUP BY 1, 2`,
      [bookDate, MOM_IDS],
    ),
    q<MomClose>(
      `SELECT ${MOM_NORM} AS account,
              UPPER(TRIM("合约")) AS contract,
              SUM(${numExpr("平仓盈亏")})::text AS pnl
       FROM public.mom_close_details
       WHERE "交易日期" = $1::date
         AND ${MOM_NORM} = ANY($2::text[])
         AND "合约" IS NOT NULL
       GROUP BY 1, 2`,
      [bookDate, MOM_IDS],
    ),
    q<MomDaily>(
      `SELECT DISTINCT ON (${MOM_NORM})
              ${MOM_NORM} AS account,
              ${numExpr("当日盈亏")}::text AS daily_pnl
       FROM public.mom_daily_reports
       WHERE "交易日期" = $1::date
         AND ${MOM_NORM} = ANY($2::text[])
       ORDER BY ${MOM_NORM}`,
      [bookDate, MOM_IDS],
    ),
    qOptional<CfmmcPos>(
      `SELECT TRIM(account_no) AS account,
              UPPER(TRIM(instrument)) AS contract,
              SUM(CASE
                WHEN COALESCE(buy_lots, 0) > 0 THEN ABS(COALESCE(notional_mv, 0))
                WHEN bs = '买' AND COALESCE(lots, 0) > 0 THEN ABS(COALESCE(notional_mv, 0))
                ELSE 0
              END)::text AS long_mv,
              SUM(CASE
                WHEN COALESCE(sell_lots, 0) > 0 THEN ABS(COALESCE(notional_mv, 0))
                WHEN bs = '卖' AND COALESCE(lots, 0) > 0 THEN ABS(COALESCE(notional_mv, 0))
                ELSE 0
              END)::text AS short_mv,
              SUM(COALESCE(floating_pl, 0))::text AS floating
       FROM public.cfmmc_positions
       WHERE TRIM(account_no) = ANY($1::text[])
         AND trade_date = $2::date
         AND instrument IS NOT NULL AND TRIM(instrument) <> ''
       GROUP BY 1, 2`,
      [CFMMC_IDS, bookDate],
    ),
    qOptional<CfmmcPos>(
      `SELECT TRIM(p.account_no) AS account,
              UPPER(TRIM(p.instrument)) AS contract,
              SUM(CASE
                WHEN COALESCE(p.buy_lots, 0) > 0 THEN ABS(COALESCE(p.notional_mv, 0))
                WHEN p.bs = '买' AND COALESCE(p.lots, 0) > 0 THEN ABS(COALESCE(p.notional_mv, 0))
                ELSE 0
              END)::text AS long_mv,
              SUM(CASE
                WHEN COALESCE(p.sell_lots, 0) > 0 THEN ABS(COALESCE(p.notional_mv, 0))
                WHEN p.bs = '卖' AND COALESCE(p.lots, 0) > 0 THEN ABS(COALESCE(p.notional_mv, 0))
                ELSE 0
              END)::text AS short_mv,
              SUM(COALESCE(p.floating_pl, 0))::text AS floating
       FROM public.cfmmc_positions p
       JOIN (
         SELECT TRIM(account_no) AS account_no, MAX(trade_date) AS prev
         FROM public.cfmmc_positions
         WHERE TRIM(account_no) = ANY($1::text[])
           AND trade_date < $2::date
         GROUP BY TRIM(account_no)
       ) d ON TRIM(p.account_no) = d.account_no AND p.trade_date = d.prev
       WHERE p.instrument IS NOT NULL AND TRIM(p.instrument) <> ''
       GROUP BY 1, 2`,
      [CFMMC_IDS, bookDate],
    ),
    qOptional<CfmmcDaily>(
      `SELECT DISTINCT ON (TRIM(account_no))
              TRIM(account_no) AS account,
              client_equity::text AS equity,
              daily_pnl::text AS daily_pnl,
              risk_ratio::text AS risk_ratio,
              NULLIF(TRIM(client_name), '') AS client_name
       FROM public.cfmmc_daily_summary
       WHERE TRIM(account_no) = ANY($1::text[])
         AND trade_date = $2::date
       ORDER BY TRIM(account_no), trade_date DESC`,
      [CFMMC_IDS, bookDate],
    ),
  ])

  const momBook = new Map<string, Bag>()
  for (const row of momPos) {
    const sector = sectorOf(row.contract)
    if (!row.account || !sector) continue
    const item = touch(momBook, row.account)
    add(item.long, sector, toNum(row.long_mv))
    add(item.short, sector, toNum(row.short_mv))
    add(item.pnl, sector, toNum(row.pnl))
  }
  for (const row of momClose) {
    const sector = sectorOf(row.contract)
    if (!row.account || !sector) continue
    add(touch(momBook, row.account).pnl, sector, toNum(row.pnl))
  }
  const momDaily = new Map<string, number>()
  for (const row of momDailyRows) {
    if (row.account) momDaily.set(row.account, toNum(row.daily_pnl))
  }

  const cfmmcBook = new Map<string, Bag>()
  for (const row of cfmmcPos) {
    const sector = sectorOf(row.contract)
    if (!row.account || !sector) continue
    const item = touch(cfmmcBook, row.account)
    add(item.long, sector, toNum(row.long_mv))
    add(item.short, sector, toNum(row.short_mv))
    add(item.float, sector, toNum(row.floating))
  }
  const prevSeen = new Set<string>()
  const prevFloat = new Map<string, Record<string, number>>()
  for (const row of cfmmcPrev) {
    if (!row.account) continue
    prevSeen.add(row.account)
    const sector = sectorOf(row.contract)
    if (!sector) continue
    const rec = prevFloat.get(row.account) ?? {}
    add(rec, sector, toNum(row.floating))
    prevFloat.set(row.account, rec)
  }
  const cfmmcDaily = new Map<string, CfmmcDaily>()
  for (const row of cfmmcDailyRows) {
    if (!row.account || cfmmcDaily.has(row.account)) continue
    cfmmcDaily.set(row.account, row)
    const name = (row.client_name ?? "").trim()
    if (name) brokerNames.set(row.account, name)
  }

  const accounts: ExposureLeg[] = QUANT_STRATEGY_ACCOUNTS.map((spec) => {
    const mom = spec.source === "mom"
    const book = (mom ? momBook : cfmmcBook).get(spec.id) ?? null
    const latest = (mom ? momLatest : cfmmcLatest).get(spec.id) ?? null
    const dailyRow = mom ? null : cfmmcDaily.get(spec.id) ?? null
    const onBook = book != null || latest === bookDate || (mom ? momDaily.has(spec.id) : dailyRow != null)
    let pnlBySector: Record<string, number> | null = null
    if (mom) pnlBySector = book?.pnl ?? {}
    else if (prevSeen.has(spec.id)) {
      pnlBySector = {}
      const keys = new Set([...Object.keys(book?.float ?? {}), ...Object.keys(prevFloat.get(spec.id) ?? {})])
      for (const key of keys) {
        const delta = (book?.float[key] ?? 0) - (prevFloat.get(spec.id)?.[key] ?? 0)
        if (delta) pnlBySector[key] = delta
      }
    }
    return {
      id: spec.id,
      label: mom ? spec.label : spec.id,
      advisor: mom ? advisors.get(spec.id) ?? null : (pmForAccount(spec.id) || shortBookName(brokerNames.get(spec.id))),
      source: spec.source,
      brokerLabel: mom ? null : spec.label,
      onBook,
      latest,
      longBySector: book?.long ?? {},
      shortBySector: book?.short ?? {},
      pnlBySector,
      dailyPnl: mom ? (momDaily.has(spec.id) ? momDaily.get(spec.id) ?? null : null) : toNumOrNull(dailyRow?.daily_pnl),
      equity: mom ? null : toNumOrNull(dailyRow?.equity),
      riskPct: mom ? null : riskPct(dailyRow?.risk_ratio),
    }
  })

  return buildPositionExposure({ date: bookDate, accounts })
}
