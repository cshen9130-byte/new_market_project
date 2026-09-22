/**
 * Backfill missing trading days in the all-weather paper book using DB settlement data.
 *
 * Usage:
 *   node scripts/backfill-all-weather-book.mjs
 *   node scripts/backfill-all-weather-book.mjs --variant vol5-10m
 *   node scripts/backfill-all-weather-book.mjs --from 2026-09-14 --to 2026-09-18
 *   node scripts/backfill-all-weather-book.mjs --dry-run
 *
 * Data sources (in priority order per asset):
 *   1. raw_futures_contracts_daily  (CFFEX .CFE / SHFE .SHF / DCE .DCE / INE .INE / GFEX .GFE)
 *      - has both `clear` (settle) and `preclear` (prev-settle) → most accurate
 *   2. raw_akshare_futures_daily    (continuous-contract code like FG0.CZC, T0.CFE)
 *      - `clear` column for CZCE; `close` for CFFEX bonds (settle=0 for CFFEX)
 *   3. Zero PnL + warning           (last resort)
 */

import pg from 'pg'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const getArg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null }
const DRY_RUN    = args.includes('--dry-run')
const VARIANT_ID = getArg('--variant') ?? 'vol9-20m'          // default variant
const ARG_FROM   = getArg('--from')
const ARG_TO     = getArg('--to')

// ── Paths ─────────────────────────────────────────────────────────────────────
const __dir = path.dirname(fileURLToPath(import.meta.url))
const DATA_ROOT = path.join(__dir, '..', 'data', 'all-weather')
const bookPath  = VARIANT_ID === 'vol9-20m'
  ? path.join(DATA_ROOT, 'book.json')
  : path.join(DATA_ROOT, VARIANT_ID, 'book.json')

// ── DB ────────────────────────────────────────────────────────────────────────
pg.types.setTypeParser(1082, v => v)   // date → raw string (avoid UTC midnight shift)
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL
    ?? 'postgresql://market_user:2026SmartDashboard!@127.0.0.1:5433/market_data'
})

// ── Exchange mapping ──────────────────────────────────────────────────────────
/** Suffix appended to specific contract codes in raw_futures_contracts_daily */
const CONTRACT_SUFFIX = {
  // CFFEX
  IF: '.CFE', IH: '.CFE', IC: '.CFE', IM: '.CFE',
  T: '.CFE', TL: '.CFE', TF: '.CFE', TS: '.CFE',
  // SHFE
  AU: '.SHF', AG: '.SHF', CU: '.SHF', AL: '.SHF',
  NI: '.SHF', SN: '.SHF', ZN: '.SHF', PB: '.SHF',
  RB: '.SHF', HC: '.SHF', BU: '.SHF', SP: '.SHF',
  BR: '.SHF', RU: '.SHF', FU: '.SHF', SS: '.SHF',
  AO: '.SHF', AD: '.SHF', NR: '.SHF', WR: '.SHF',
  // INE
  SC: '.INE', BC: '.INE', LU: '.INE', EC: '.INE',
  // GFEX
  LC: '.GFE', PS: '.GFE', SI: '.GFE',
  // DCE (no CZCE – CZCE not in raw_futures_contracts_daily)
  I: '.DCE', J: '.DCE', JM: '.DCE', M: '.DCE',
  Y: '.DCE', C: '.DCE', CS: '.DCE', P: '.DCE',
  A: '.DCE', B: '.DCE', JD: '.DCE', LH: '.DCE',
  EB: '.DCE', EG: '.DCE', PG: '.DCE', PP: '.DCE',
  V: '.DCE', L: '.DCE', LG: '.DCE', RR: '.DCE',
  BB: '.DCE', FB: '.DCE', BZ: '.DCE',
}

/** Continuous-contract code in raw_akshare_futures_daily (fallback / CZCE primary) */
const AKSHARE_CODE = {
  IF: 'IF0.CFE', IH: 'IH0.CFE', IC: 'IC0.CFE', IM: 'IM0.CFE',
  T:  'T0.CFE',  TL: 'TL0.CFE', TF: 'TF0.CFE', TS: 'TS0.CFE',
  AU: 'AU0.SHF', AG: 'AG0.SHF', CU: 'CU0.SHF', AL: 'AL0.SHF',
  NI: 'NI0.SHF', SN: 'SN0.SHF', ZN: 'ZN0.SHF', PB: 'PB0.SHF',
  RB: 'RB0.SHF', HC: 'HC0.SHF', BU: 'BU0.SHF', SP: 'SP0.SHF',
  BR: 'BR0.SHF', RU: 'RU0.SHF', FU: 'FU0.SHF', SS: 'SS0.SHF',
  SC: 'SCM.INE', BC: 'BCM.INE', LU: 'LUM.INE',
  LC: 'LCM.GFE',
  I: 'I0.DCE', J: 'J0.DCE', JM: 'JM0.DCE', M: 'M0.DCE',
  Y: 'Y0.DCE', C: 'C0.DCE', CS: 'CS0.DCE', P: 'P0.DCE',
  A: 'A0.DCE', B: 'B0.DCE', JD: 'JD0.DCE', LH: 'LH0.DCE',
  EB: 'EB0.DCE', EG: 'EG0.DCE', PG: 'PG0.DCE', PP: 'PP0.DCE',
  V: 'V0.DCE', L: 'L0.DCE', LG: 'LG0.DCE',
  // CZCE (primary source for these)
  FG: 'FG0.CZC', SR: 'SR0.CZC', CF: 'CF0.CZC', TA: 'TA0.CZC',
  MA: 'MA0.CZC', PX: 'PX0.CZC', UR: 'UR0.CZC', ZC: 'ZC0.CZC',
  RM: 'RM0.CZC', OI: 'OI0.CZC', SA: 'SA0.CZC', AP: 'AP0.CZC',
  CJ: 'CJ0.CZC', CY: 'CY0.CZC', PM: 'PM0.CZC', PF: 'PF0.CZC',
  SH: 'SH0.CZC', SM: 'SM0.CZC', SF: 'SF0.CZC', WH: 'WH0.CZC',
  RS: 'RS0.CZC', PK: 'PK0.CZC', PR: 'PR0.CZC',
}

/** CZCE assets: no specific-contract data in raw_futures_contracts_daily */
const CZCE_ASSETS = new Set([
  'FG','SR','CF','TA','MA','PX','UR','ZC','RM','OI','SA','AP',
  'CJ','CY','PM','PF','SH','SM','SF','WH','RS','PK','PR',
])

/** For CFFEX: settle is not stored; use `close` from raw_akshare_futures_daily instead */
const CFFEX_ASSETS = new Set(['IF','IH','IC','IM','T','TL','TF','TS'])

function extractSymbol(contract) {
  return contract.replace(/\d+$/, '').replace(/\.[A-Z]+$/, '')
}

// ── Utility ───────────────────────────────────────────────────────────────────
function isoDate(d) {
  return typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10)
}

function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

async function tradingDaysBetween(after, before) {
  // "after" is exclusive, "before" is inclusive
  const res = await pool.query(
    `SELECT DISTINCT trade_date FROM raw_futures_contracts_daily
     WHERE trade_date > $1 AND trade_date <= $2
     ORDER BY trade_date`,
    [after, before]
  )
  return res.rows.map(r => r.trade_date)
}

// ── Price fetch ───────────────────────────────────────────────────────────────
/**
 * Fetch settlement prices from the DB for all dates in `dates`.
 * Returns Map<date, Map<asset, settle>>
 */
async function fetchSettlePrices(assets, dates) {
  if (!dates.length || !assets.length) return new Map()

  // Build a set of contracts+suffixes for specific-contract lookup
  const contractAssets = assets.filter(a => !CZCE_ASSETS.has(a))
  const czceAssets     = assets.filter(a => CZCE_ASSETS.has(a))

  // ① raw_futures_contracts_daily: specific contracts with exchange suffix
  // We fetch ALL contracts for each symbol so we can match by held contract later
  const contractRows = contractAssets.length ? await pool.query(
    `SELECT trade_date, contract, clear::float AS settle, preclear::float AS pre_settle
     FROM raw_futures_contracts_daily
     WHERE trade_date = ANY($1)
     AND (${contractAssets.map(a => `contract LIKE '${a}%'`).join(' OR ')})
     ORDER BY trade_date, contract`,
    [dates]
  ) : { rows: [] }

  // ② raw_akshare_futures_daily: continuous code for CZCE (clear=settle) and CFFEX (close=settle)
  const allAkCodes = [
    ...czceAssets.map(a => AKSHARE_CODE[a]).filter(Boolean),
    ...assets.filter(a => CFFEX_ASSETS.has(a)).map(a => AKSHARE_CODE[a]).filter(Boolean),
    // Also fetch all non-CZCE as fallback
    ...contractAssets.filter(a => !CFFEX_ASSETS.has(a)).map(a => AKSHARE_CODE[a]).filter(Boolean),
  ]
  const akRows = allAkCodes.length ? await pool.query(
    `SELECT trade_date, code, clear::float AS settle, close::float AS close_px
     FROM raw_akshare_futures_daily
     WHERE trade_date = ANY($1)
     AND code = ANY($2)
     ORDER BY trade_date, code`,
    [dates, [...new Set(allAkCodes)]]
  ) : { rows: [] }

  // Build lookup maps
  // contractMap: date → contract_with_suffix → { settle, pre_settle }
  const contractMap = new Map()
  for (const r of contractRows.rows) {
    const d = r.trade_date
    if (!contractMap.has(d)) contractMap.set(d, new Map())
    contractMap.get(d).set(r.contract, { settle: r.settle, pre_settle: r.pre_settle })
  }
  // akshareMap: date → ak_code → { settle, close_px }
  const akshareMap = new Map()
  for (const r of akRows.rows) {
    const d = r.trade_date
    if (!akshareMap.has(d)) akshareMap.set(d, new Map())
    akshareMap.get(d).set(r.code, { settle: r.settle, close_px: r.close_px })
  }

  return { contractMap, akshareMap }
}

/**
 * Get settle price for a specific held contract on a given date.
 * `heldContract` is like "IF2609", `asset` is "IF".
 * Returns the settle price or null.
 */
function resolveSettle(date, asset, heldContract, contractMap, akshareMap) {
  const sym = asset || extractSymbol(heldContract)

  // ─ CZCE: always use akshare continuous code ─
  if (CZCE_ASSETS.has(sym)) {
    const ak = akshareMap.get(date)
    const code = AKSHARE_CODE[sym]
    if (ak && code) {
      const row = ak.get(code)
      if (row && row.settle && row.settle > 0) return row.settle
    }
    return null
  }

  // ─ CFFEX: use specific contract from raw_futures_contracts_daily (with .CFE suffix) ─
  if (CFFEX_ASSETS.has(sym)) {
    const suffix = CONTRACT_SUFFIX[sym]
    const cm = contractMap.get(date)
    if (cm && suffix) {
      const key = heldContract + suffix
      const row = cm.get(key)
      if (row && row.settle != null) return row.settle
      // Fallback: find any same-symbol contract with non-null settle (handles expiry rollover)
      for (const [k, v] of cm) {
        if (k.startsWith(sym) && k.endsWith(suffix) && v.settle != null) {
          console.warn(`    ⚠ ${sym}: using fallback contract ${k} (held: ${heldContract})`)
          return v.settle
        }
      }
    }
    // Final fallback for T: use close from akshare T0.CFE
    const ak = akshareMap.get(date)
    const code = AKSHARE_CODE[sym]
    if (ak && code) {
      const row = ak.get(code)
      if (row && row.close_px && row.close_px > 0) {
        console.warn(`    ⚠ ${sym}: using akshare close (no settle in contracts table)`)
        return row.close_px
      }
    }
    return null
  }

  // ─ Others (SHFE/DCE/INE/GFEX): specific contract preferred ─
  const suffix = CONTRACT_SUFFIX[sym]
  const cm = contractMap.get(date)
  if (cm && suffix) {
    const key = heldContract + suffix
    const row = cm.get(key)
    if (row && row.settle != null) return row.settle
    // Try without suffix as fallback
    const rowNoSuffix = cm.get(heldContract)
    if (rowNoSuffix && rowNoSuffix.settle != null) return rowNoSuffix.settle
  }
  // Akshare continuous fallback
  const ak = akshareMap.get(date)
  const code = AKSHARE_CODE[sym]
  if (ak && code) {
    const row = ak.get(code)
    if (row) {
      const val = row.settle && row.settle > 0 ? row.settle : row.close_px
      if (val && val > 0) {
        console.warn(`    ⚠ ${sym}: using akshare continuous (${code})`)
        return val
      }
    }
  }
  return null
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(bookPath)) {
    console.error(`Book not found: ${bookPath}`)
    process.exit(1)
  }

  const book = JSON.parse(fs.readFileSync(bookPath, 'utf-8'))
  const lastDate = isoDate(book.asOf)
  const today    = isoDate(new Date().toLocaleString('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).replace(/\//g, '-'))
  const fromDate = ARG_FROM ?? lastDate
  const toDate   = ARG_TO   ?? today

  console.log(`Backfill  variant=${VARIANT_ID}  book.asOf=${lastDate}  range=[${fromDate}, ${toDate}]  dry-run=${DRY_RUN}`)
  console.log(`Book path: ${bookPath}`)

  // ── Find missing trading days ──────────────────────────────────────────────
  // Trading days that exist in the DB in [fromDate+1, toDate] that are not in book.daily
  const existingDates = new Set(book.daily.map(r => isoDate(r.date)))
  const allTradingDays = await tradingDaysBetween(fromDate, toDate)
  const missingDates   = allTradingDays.filter(d => !existingDates.has(d))

  if (!missingDates.length) {
    console.log('No missing trading days found — nothing to do.')
    process.exit(0)
  }
  console.log(`Missing dates: ${missingDates.join(', ')}`)

  // ── Collect all held positions (only those with lots > 0) ─────────────────
  const heldPositions = book.positions.filter(p => (p.lots ?? 0) > 0)
  const assets = [...new Set(heldPositions.map(p => p.asset))]
  console.log(`Held assets (${heldPositions.length}): ${assets.join(', ')}`)

  // ── Fetch all settle prices in one query per table ─────────────────────────
  // Include fromDate so we have pre_settle reference for the first missing day
  const allDatesNeeded = [fromDate, ...missingDates]
  const { contractMap, akshareMap } = await fetchSettlePrices(assets, allDatesNeeded)

  // ── Build prev-settle for each asset from the reference date (fromDate) ────
  // Prefer: DB pre_settle on first missing day → DB settle on fromDate → book position.price
  const prevSettleByAsset = {}
  for (const pos of heldPositions) {
    const sym = pos.asset
    const heldContract = pos.contract

    // Try pre_settle from DB for first missing day
    const firstMissingDay = missingDates[0]
    let prevSettle = null

    if (!CZCE_ASSETS.has(sym) && !CFFEX_ASSETS.has(sym)) {
      const suffix = CONTRACT_SUFFIX[sym]
      const cm = contractMap.get(firstMissingDay)
      if (cm && suffix) {
        const row = cm.get(heldContract + suffix)
        if (row && row.pre_settle != null) {
          prevSettle = row.pre_settle
        }
      }
    }
    // CFFEX: pre_settle available in raw_futures_contracts_daily
    if (!prevSettle && CFFEX_ASSETS.has(sym)) {
      const suffix = CONTRACT_SUFFIX[sym]
      const cm = contractMap.get(firstMissingDay)
      if (cm && suffix) {
        const row = cm.get(heldContract + suffix)
        if (row && row.pre_settle != null) prevSettle = row.pre_settle
        else {
          // Try any contract of same symbol
          for (const [k, v] of cm) {
            if (k.startsWith(sym) && k.endsWith(suffix) && v.pre_settle != null) {
              prevSettle = v.pre_settle; break
            }
          }
        }
      }
    }
    // Fallback: settle on fromDate (the last day in the book)
    if (!prevSettle) {
      prevSettle = resolveSettle(fromDate, sym, heldContract, contractMap, akshareMap)
    }
    // Fallback: book position.price
    if (!prevSettle) {
      prevSettle = pos.price
      console.warn(`  ⚠ ${sym}: using book.position.price as prev settle (${prevSettle})`)
    }
    prevSettleByAsset[sym] = prevSettle
  }

  // ── Cumulative PnL tracking per position (from book's current cumPnl) ──────
  const cumPnlByAsset  = {}
  const prevPrevSettle = {}  // settle of the day before the last backfilled day
  for (const pos of heldPositions) cumPnlByAsset[pos.asset] = pos.cumPnl ?? 0

  // Current equity / daily tracking
  let equity = book.equity

  // ── Iterate over missing days ─────────────────────────────────────────────
  const newDailyRows = []
  const SLEEVE_KEYS = ['Equity', 'Bonds', 'Gold', 'Commodity']

  for (const date of missingDates) {
    const sleevePnl = { Equity: 0, Bonds: 0, Gold: 0, Commodity: 0 }
    const productPnl = {}
    let dayPnl = 0

    for (const pos of heldPositions) {
      const sym = pos.asset
      const settle = resolveSettle(date, sym, pos.contract, contractMap, akshareMap)

      if (settle == null) {
        console.warn(`  ⚠ ${date} ${sym}: no settle price found — using 0 PnL`)
        productPnl[sym] = 0
        continue
      }

      const prev = prevSettleByAsset[sym] ?? pos.price
      const pnl  = pos.lots * (settle - prev) * pos.multiplier

      dayPnl             += pnl
      sleevePnl[pos.sleeve] = (sleevePnl[pos.sleeve] ?? 0) + pnl
      productPnl[sym]    = pnl
      cumPnlByAsset[sym] = (cumPnlByAsset[sym] ?? 0) + pnl

      // Advance prev settle for next day (save current before overwriting)
      prevPrevSettle[sym]    = prevSettleByAsset[sym]
      prevSettleByAsset[sym] = settle
    }

    equity += dayPnl
    newDailyRows.push({ date, equity, dailyPnl: dayPnl, sleevePnl, productPnl })

    const pnlStr = dayPnl >= 0 ? `+${dayPnl.toFixed(0)}` : dayPnl.toFixed(0)
    console.log(`  ${date}  equity=${equity.toFixed(0)}  dailyPnl=${pnlStr}`)
  }

  if (DRY_RUN) {
    console.log('\n[dry-run] would insert rows:')
    newDailyRows.forEach(r => console.log(' ', JSON.stringify(r)))
    await pool.end()
    return
  }

  // ── Merge new rows into book.daily ────────────────────────────────────────
  const daily = [...book.daily, ...newDailyRows]
  daily.sort((a, b) => a.date.localeCompare(b.date))

  // Remove duplicates (keep last)
  const dailyMap = new Map()
  for (const r of daily) dailyMap.set(r.date, r)
  const sortedDaily = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date))

  const lastRow   = sortedDaily[sortedDaily.length - 1]
  const lastDate2 = lastRow?.date ?? book.asOf

  // ── Update positions' prices and cumPnl to end of backfill ────────────────
  const updatedPositions = book.positions.map(pos => {
    const sym = pos.asset
    const lastSettle = prevSettleByAsset[sym]  // set to last day's settle
    if (!lastSettle || (pos.lots ?? 0) === 0) return pos
    const lastDayPnl = missingDates.length > 0
      ? (newDailyRows.at(-1)?.productPnl?.[sym] ?? 0)
      : pos.dailyPnl
    return {
      ...pos,
      price:    lastSettle,
      prevPrice: prevPrevSettle[sym] ?? pos.prevPrice,
      dailyPnl: lastDayPnl,
      cumPnl:   cumPnlByAsset[sym] ?? pos.cumPnl,
    }
  })

  // ── Write updated book ────────────────────────────────────────────────────
  const updatedBook = {
    ...book,
    asOf:         lastDate2,
    equity:       lastRow?.equity ?? book.equity,
    dailyPnl:     lastRow?.dailyPnl ?? book.dailyPnl,
    cumPnl:       (lastRow?.equity ?? book.equity) - book.initialCapital,
    priceSource:  'snapshot',
    pricesFetchedAt: new Date().toISOString(),
    positions:    updatedPositions,
    daily:        sortedDaily,
  }

  fs.writeFileSync(bookPath, JSON.stringify(updatedBook, null, 2), 'utf-8')
  console.log(`\n✓ Backfilled ${newDailyRows.length} days → asOf=${lastDate2}  equity=${updatedBook.equity.toFixed(0)}`)
  console.log(`  Book written: ${bookPath}`)

  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
