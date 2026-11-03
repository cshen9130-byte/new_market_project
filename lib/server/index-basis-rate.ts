import {
  annualizedBasisPct,
  calendarDaysToCffexExpiry,
  CFFEX_CONTRACT_ROLES,
  listedCffexIndexContractsOnYmd,
  parseIndexFuturesMonth,
  type CffexContractRole,
} from "@/lib/client/cffex-expiry"
import { query } from "@/lib/db"
import { chinaWallToUnix } from "@/lib/server/sina-fetch"

export type BasisRatePoint = { time: number; value: number }

const PRODUCTS = new Set(["IH", "IF", "IC", "IM"])
const ROLE_IDS = CFFEX_CONTRACT_ROLES.map((role) => role.id)

type Cache = {
  at: number
  roles: Record<CffexContractRole, BasisRatePoint[]>
}

const cache = new Map<string, Cache>()
const CACHE_MS = 60_000

function shanghaiNoon(ymd: string) {
  return new Date(`${ymd}T04:00:00Z`)
}

function point(ymd: string, futures: number, spot: number, symbol: string): BasisRatePoint | null {
  const days = calendarDaysToCffexExpiry(symbol, shanghaiNoon(ymd))
  // Expiry day (T <= 1) turns a few ticks into hundreds of percent.
  if (days == null || days < 2) return null
  const value = annualizedBasisPct(futures, spot, days)
  const time = chinaWallToUnix(`${ymd} 00:00:00`)
  if (value == null || time == null) return null
  return { time, value }
}

async function loadBook(product: string) {
  const [futures, spots] = await Promise.all([
    query<{ trade_date: string; root: string; px: string | number }>(
      `SELECT DISTINCT ON (trade_date, upper(split_part(contract, '.', 1)))
              trade_date::text AS trade_date,
              upper(split_part(contract, '.', 1)) AS root,
              COALESCE(NULLIF(close, 0), NULLIF(clear, 0)) AS px
         FROM raw_futures_contracts_daily
        WHERE upper(split_part(contract, '.', 1)) ~ ('^' || $1 || '[0-9]{4}$')
        ORDER BY trade_date, upper(split_part(contract, '.', 1)),
                 CASE WHEN position('.' in contract) = 0 THEN 0 ELSE 1 END`,
      [product],
    ),
    query<{ trade_date: string; spot: string | number }>(
      `SELECT DISTINCT ON (trade_date)
              trade_date::text AS trade_date,
              close AS spot
         FROM raw_spot_daily
        WHERE symbol = $1 AND close IS NOT NULL AND close <> 0
        ORDER BY trade_date, CASE WHEN source = 'emquant' THEN 0 ELSE 1 END`,
      [product],
    ),
  ])
  const spotByDay = new Map<string, number>()
  for (const row of spots) {
    const spot = Number(row.spot)
    if (spot > 0) spotByDay.set(row.trade_date.slice(0, 10), spot)
  }
  const pxByDay = new Map<string, Map<string, number>>()
  for (const row of futures) {
    const px = Number(row.px)
    if (!(px > 0)) continue
    const day = row.trade_date.slice(0, 10)
    const book = pxByDay.get(day) ?? new Map<string, number>()
    book.set(row.root, px)
    pxByDay.set(day, book)
  }
  return { spotByDay, pxByDay }
}

/** IHL / L1 / L2 / L3 closes are 当月 / 下月 / 当季 / 下季. They cover days the contract table skips. */
async function loadRoleLegs(product: string) {
  const codes = ["L", "L1", "L2", "L3"].map((leg) => `${product}${leg}.CFX`)
  const rows = await query<{ trade_date: string; ts_code: string; px: string | number }>(
    `SELECT trade_date::text AS trade_date, upper(ts_code) AS ts_code, close AS px
       FROM raw_futures_daily
      WHERE upper(ts_code) = ANY($1)
        AND close IS NOT NULL AND close > 0`,
    [codes],
  )
  const byDay = new Map<string, Array<number | undefined>>()
  for (const row of rows) {
    const px = Number(row.px)
    const index = codes.indexOf(row.ts_code)
    if (!(px > 0) || index < 0) continue
    const day = row.trade_date.slice(0, 10)
    const slot = byDay.get(day) ?? []
    slot[index] = px
    byDay.set(day, slot)
  }
  return byDay
}

/** Each day uses the contract that held this term then, with that contract's own days. */
export async function getRollingIndexBasis(product: string) {
  const code = product.trim().toUpperCase()
  if (!PRODUCTS.has(code)) return null
  const hit = cache.get(code)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.roles

  const [{ spotByDay, pxByDay }, legsByDay] = await Promise.all([loadBook(code), loadRoleLegs(code)])
  const roles = Object.fromEntries(ROLE_IDS.map((id) => [id, [] as BasisRatePoint[]])) as Record<
    CffexContractRole,
    BasisRatePoint[]
  >
  const days = new Set([...pxByDay.keys(), ...legsByDay.keys()])
  for (const day of [...days].sort()) {
    const spot = spotByDay.get(day)
    if (spot == null) continue
    const book = pxByDay.get(day)
    const legs = legsByDay.get(day)
    listedCffexIndexContractsOnYmd(code, day).forEach((symbol, index) => {
      const px = book?.get(symbol) ?? legs?.[index]
      const role = ROLE_IDS[index]
      if (px == null || !role) return
      const row = point(day, px, spot, symbol)
      if (row) roles[role].push(row)
    })
  }
  cache.set(code, { at: Date.now(), roles })
  return roles
}

/** One named month, from its own prints only. */
export async function getOwnIndexBasis(symbol: string): Promise<BasisRatePoint[] | null> {
  const parsed = parseIndexFuturesMonth(symbol)
  if (!parsed) return null
  const contract = symbol.trim().toUpperCase()
  const { spotByDay, pxByDay } = await loadBook(parsed.product)
  const points: BasisRatePoint[] = []
  for (const day of [...pxByDay.keys()].sort()) {
    const spot = spotByDay.get(day)
    const px = pxByDay.get(day)?.get(contract)
    if (spot == null || px == null) continue
    const row = point(day, px, spot, contract)
    if (row) points.push(row)
  }
  return points
}
