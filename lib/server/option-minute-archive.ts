import type { OverlayPoint } from "@/lib/client/realtime-overlay"
import { publicQuery, publicWithClient } from "@/lib/db"
import {
  fetchEtfCaptureMinutes,
  fetchEtfSpotMinutes,
  ivBarsFromPair,
  listEtfCaptureContracts,
} from "@/lib/server/atm-iv-minute"
import {
  fetchCffexCaptureMinutes,
  fetchCffexSpotMinutes,
  listCffexCaptureContracts,
} from "@/lib/server/cffex-atm-iv-minute"
import { chinaWallToUnix } from "@/lib/server/sina-fetch"
import { inSessionMinute, type CaptureContract, type StoredMinute } from "@/lib/server/option-minute-types"

const KEEP_SESSIONS = 10
const LOCK_KEY = 81421011
const SWEEP_SIZE = 80
const HISTORY_RETRY_MS = 30 * 60_000

const LISTED: Record<string, string> = {
  "50etf": "510050",
  "300etf": "510300",
  "500etf": "510500",
}

type Gate = {
  running: boolean
  at: number
  cursor: number
  historyAttemptAt: number
  flush: boolean
}

declare global {
  // eslint-disable-next-line no-var
  var __optionMinuteCapture: Gate | undefined
}

function gate(): Gate {
  if (!globalThis.__optionMinuteCapture) {
    globalThis.__optionMinuteCapture = { running: false, at: 0, cursor: 0, historyAttemptAt: 0, flush: false }
  }
  return globalThis.__optionMinuteCapture
}

let schemaReady = false

function shanghaiParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(now)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || ""
  const hour = Number(get("hour"))
  const minute = Number(get("minute"))
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0),
    weekday: get("weekday"),
  }
}

function inCaptureWindow(now = new Date()) {
  const parts = shanghaiParts(now)
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false
  const n = parts.minutes
  return (n >= 9 * 60 + 25 && n <= 11 * 60 + 35) || (n >= 12 * 60 + 55 && n <= 15 * 60 + 8)
}

function minuteDate(day: string, hhmm: string) {
  const date = new Date(`${day}T${hhmm}:00+08:00`)
  return Number.isFinite(date.getTime()) ? date : null
}

function wallOf(date: Date) {
  const parts = shanghaiParts(date)
  const hh = String(Math.floor(parts.minutes / 60)).padStart(2, "0")
  const mm = String(parts.minutes % 60).padStart(2, "0")
  return { day: parts.day, hhmm: `${hh}:${mm}` }
}

function wallUnix(date: Date) {
  const wall = wallOf(date)
  return chinaWallToUnix(`${wall.day} ${wall.hhmm}:00`)
}

function dayKey(unix: number) {
  const date = new Date(unix * 1000)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

function addDays(day: string, days: number) {
  const [year, month, date] = day.split("-").map(Number)
  const utc = Date.UTC(year, month - 1, date) + days * 86400_000
  const next = new Date(utc)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`
}

export function archiveCovers(key: string, sessions: number, days: number) {
  if (!(sessions > 0)) return false
  if (days <= 1) return true
  if (sessions < 2) return false
  // CFFEX history hosts are unreliable, so two stored sessions already beat a daily fallback.
  if (key.endsWith("index")) return true
  // Sina's five-day line is the outside ceiling for ETF options.
  return sessions >= Math.min(days, 6)
}

async function ensureSchema() {
  if (schemaReady) return
  await publicQuery(`
    CREATE TABLE IF NOT EXISTS raw_option_contract (
      underlying_key TEXT NOT NULL,
      contract_id    TEXT NOT NULL,
      side           TEXT NOT NULL,
      month_code     TEXT NOT NULL DEFAULT '',
      strike         DOUBLE PRECISION,
      expire_day     DATE,
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (underlying_key, contract_id)
    )
  `)
  await publicQuery(`
    CREATE TABLE IF NOT EXISTS raw_option_minute (
      underlying_key TEXT NOT NULL,
      contract_id    TEXT NOT NULL,
      bar_time       TIMESTAMPTZ NOT NULL,
      price          DOUBLE PRECISION NOT NULL,
      volume         DOUBLE PRECISION,
      PRIMARY KEY (underlying_key, contract_id, bar_time)
    )
  `)
  await publicQuery(`
    CREATE INDEX IF NOT EXISTS idx_raw_option_minute_key_time
      ON raw_option_minute (underlying_key, bar_time DESC)
  `)
  await publicQuery(`
    CREATE TABLE IF NOT EXISTS raw_option_minute_state (
      job         TEXT PRIMARY KEY,
      finished_on DATE NOT NULL,
      row_count   INTEGER NOT NULL DEFAULT 0,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  schemaReady = true
}

function deduped(rows: StoredMinute[]) {
  const map = new Map<string, StoredMinute>()
  for (const row of rows) {
    if (!(row.price > 0) || !inSessionMinute(row.hhmm) || !minuteDate(row.day, row.hhmm)) continue
    map.set(`${row.underlyingKey}|${row.contractId}|${row.day}|${row.hhmm}`, row)
  }
  return [...map.values()]
}

async function upsertMinutes(rows: StoredMinute[]) {
  const unique = deduped(rows)
  if (!unique.length) return 0
  await ensureSchema()
  const contracts = new Map<string, StoredMinute>()
  for (const row of unique) contracts.set(`${row.underlyingKey}|${row.contractId}`, row)
  const book = [...contracts.values()]
  await publicQuery(
    `INSERT INTO raw_option_contract (underlying_key, contract_id, side, month_code, strike, expire_day, updated_at)
     SELECT u.key, u.id, u.side, u.month, u.strike, u.expire, NOW()
     FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::float8[], $6::date[])
       AS u(key, id, side, month, strike, expire)
     ON CONFLICT (underlying_key, contract_id) DO UPDATE SET
       side = EXCLUDED.side,
       month_code = EXCLUDED.month_code,
       strike = EXCLUDED.strike,
       expire_day = COALESCE(EXCLUDED.expire_day, raw_option_contract.expire_day),
       updated_at = NOW()`,
    [
      book.map((row) => row.underlyingKey),
      book.map((row) => row.contractId),
      book.map((row) => row.side),
      book.map((row) => row.monthCode),
      book.map((row) => row.strike),
      book.map((row) => row.expireDay),
    ],
  )
  let written = 0
  for (let i = 0; i < unique.length; i += 4000) {
    const chunk = unique.slice(i, i + 4000)
    const times: Date[] = []
    const keep: StoredMinute[] = []
    for (const row of chunk) {
      const at = minuteDate(row.day, row.hhmm)
      if (!at) continue
      keep.push(row)
      times.push(at)
    }
    if (!keep.length) continue
    await publicQuery(
      `INSERT INTO raw_option_minute (underlying_key, contract_id, bar_time, price, volume)
       SELECT * FROM UNNEST($1::text[], $2::text[], $3::timestamptz[], $4::float8[], $5::float8[])
       ON CONFLICT (underlying_key, contract_id, bar_time) DO UPDATE SET
         price = EXCLUDED.price,
         volume = COALESCE(EXCLUDED.volume, raw_option_minute.volume)`,
      [
        keep.map((row) => row.underlyingKey),
        keep.map((row) => row.contractId),
        times,
        keep.map((row) => row.price),
        keep.map((row) => row.volume),
      ],
    )
    written += keep.length
  }
  return written
}

async function pruneOldSessions() {
  await publicQuery(`
    DELETE FROM raw_option_minute
    WHERE (bar_time AT TIME ZONE 'Asia/Shanghai')::date NOT IN (
      SELECT day FROM (
        SELECT DISTINCT (bar_time AT TIME ZONE 'Asia/Shanghai')::date AS day
        FROM raw_option_minute
        ORDER BY day DESC
        LIMIT ${KEEP_SESSIONS}
      ) keep
    )
  `)
}

async function jobDone(job: string, day: string) {
  const res = await publicQuery(`SELECT finished_on::text AS finished_on FROM raw_option_minute_state WHERE job = $1`, [job])
  const finished = (res.rows[0] as { finished_on?: string } | undefined)?.finished_on
  return finished === day
}

async function markJob(job: string, day: string, rowCount: number) {
  await publicQuery(
    `INSERT INTO raw_option_minute_state (job, finished_on, row_count, updated_at)
     VALUES ($1, $2::date, $3, NOW())
     ON CONFLICT (job) DO UPDATE SET finished_on = EXCLUDED.finished_on, row_count = EXCLUDED.row_count, updated_at = NOW()`,
    [job, day, rowCount],
  )
}

async function ingestChunks(contracts: CaptureContract[], history: boolean, etf: boolean) {
  let written = 0
  const size = etf ? 12 : 24
  for (let i = 0; i < contracts.length; i += size) {
    const slice = contracts.slice(i, i + size)
    const rows = etf ? await fetchEtfCaptureMinutes(slice, history) : await fetchCffexCaptureMinutes(slice)
    written += await upsertMinutes(rows)
  }
  return written
}

async function withLock(work: () => Promise<void>) {
  await publicWithClient(async (client) => {
    const locked = await client.query<{ ok: boolean }>(`SELECT pg_try_advisory_lock($1::bigint) AS ok`, [LOCK_KEY])
    if (!locked.rows[0]?.ok) return
    try {
      await work()
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1::bigint)`, [LOCK_KEY])
    }
  })
}

async function runCapture() {
  await ensureSchema()
  const today = shanghaiParts().day
  const session = inCaptureWindow()
  const g = gate()
  const flush = g.flush
  g.flush = false
  const etfDone = await jobDone("etf-history", today)
  const cffexDone = await jobDone("cffex-book", today)
  const spotsDone = await jobDone("spots-10d", today)
  const dueHistory = (!etfDone || !cffexDone) && Date.now() - g.historyAttemptAt >= HISTORY_RETRY_MS
  if (!dueHistory && !session && !flush && spotsDone) return

  await withLock(async () => {
    if (!spotsDone) {
      const spotRows =
        (await upsertMinutes(await fetchEtfSpotMinutes(KEEP_SESSIONS))) +
        (await upsertMinutes(await fetchCffexSpotMinutes(KEEP_SESSIONS)))
      if (spotRows > 1000) await markJob("spots-10d", today, spotRows)
      console.log(`[option-minute] spots rows=${spotRows}`)
      if (!dueHistory && !session && !flush) return
    }
    if (dueHistory) {
      g.historyAttemptAt = Date.now()
      let etfRows = 0
      let cffexRows = 0
      if (!etfDone) {
        const contracts = await listEtfCaptureContracts()
        etfRows = await ingestChunks(contracts, true, true)
        etfRows += await upsertMinutes(await fetchEtfSpotMinutes(KEEP_SESSIONS))
        if (contracts.length && etfRows > 20_000) await markJob("etf-history", today, etfRows)
      }
      if (!cffexDone) {
        const contracts = await listCffexCaptureContracts()
        cffexRows = await ingestChunks(contracts, false, false)
        cffexRows += await upsertMinutes(await fetchCffexSpotMinutes(KEEP_SESSIONS))
        if (contracts.length && cffexRows > 5_000) await markJob("cffex-book", today, cffexRows)
      }
      await pruneOldSessions()
      console.log(`[option-minute] history etfRows=${etfRows} cffexRows=${cffexRows}`)
      return
    }

    const etfBook = await listEtfCaptureContracts()
    const cffexBook = await listCffexCaptureContracts()
    const book = [...etfBook, ...cffexBook]
    if (!book.length) return
    const count = flush ? book.length : Math.min(SWEEP_SIZE, book.length)
    const start = flush ? 0 : g.cursor % book.length
    const slice: CaptureContract[] = []
    for (let i = 0; i < count; i += 1) slice.push(book[(start + i) % book.length]!)
    if (!flush) g.cursor = (start + count) % book.length
    const etfSlice = slice.filter((row) => row.underlyingKey.endsWith("etf"))
    const cffexSlice = slice.filter((row) => row.underlyingKey.endsWith("index"))
    const written =
      (await ingestChunks(etfSlice, false, true)) +
      (await ingestChunks(cffexSlice, false, false)) +
      (await upsertMinutes(await fetchEtfSpotMinutes(1))) +
      (await upsertMinutes(await fetchCffexSpotMinutes(1)))
    if (flush || g.cursor === 0) await pruneOldSessions()
    console.log(`[option-minute] sweep rows=${written} cursor=${g.cursor} flush=${flush}`)
  })
}

/** Start a capture if one is not already running. Safe to call from the page poll. */
export function kickOptionMinuteCapture(opts?: { flush?: boolean }) {
  const g = gate()
  if (opts?.flush) g.flush = true
  if (g.running) return
  if (!opts?.flush && Date.now() - g.at < 45_000) return
  g.running = true
  void runCapture()
    .catch((err) => console.error("[option-minute]", err instanceof Error ? err.message : err))
    .finally(() => {
      g.running = false
      g.at = Date.now()
    })
}

type ContractRow = {
  contract_id: string
  side: string
  month_code: string
  strike: number | null
  expire_day: string | null
}

type MinuteRow = { contract_id: string; bar_time: Date; price: number }

function pickFrontMonth(rows: ContractRow[], today: string) {
  const months = new Map<string, string>()
  for (const row of rows) {
    if (!row.month_code || !row.expire_day || row.side === "spot") continue
    const prev = months.get(row.month_code)
    if (!prev || row.expire_day < prev) months.set(row.month_code, row.expire_day)
  }
  const items = [...months.entries()].map(([month, expire]) => ({ month, expire }))
  const horizon = addDays(today, 7)
  const mature = items.filter((item) => item.expire >= horizon).sort((a, b) => a.expire.localeCompare(b.expire))
  if (mature[0]) return mature[0].month
  const future = items.filter((item) => item.expire >= today).sort((a, b) => a.expire.localeCompare(b.expire))
  if (future[0]) return future[0].month
  return items.sort((a, b) => b.expire.localeCompare(a.expire))[0]?.month || null
}

function sameStrike(a: number, b: number) {
  return Math.abs(a - b) < (Math.max(a, b) >= 100 ? 0.5 : 1e-3)
}

function formatStrike(strike: number) {
  if (strike >= 100) return String(Math.round(strike))
  return strike.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")
}

function pairLabel(key: string, month: string, strike: number, callId: string, putId: string) {
  if (key.endsWith("index")) return `${callId} / ${putId}`
  const listed = LISTED[key] || key
  const text = formatStrike(strike)
  return `${listed}购${month}-${text} / ${listed}沽${month}-${text}`
}

const readCache = new Map<string, { at: number; value: { bars: OverlayPoint[]; contract: string; sessions: number } | null }>()
const tipAt = new Map<string, number>()

async function refreshTip(key: string, month: string, strike: number | null) {
  const res = await publicQuery(
    `SELECT contract_id, side, month_code, strike, expire_day::text AS expire_day
     FROM raw_option_contract
     WHERE underlying_key = $1 AND month_code = $2`,
    [key, month],
  )
  const rows = res.rows as ContractRow[]
  const byStrike = new Map<number, { call?: ContractRow; put?: ContractRow }>()
  for (const row of rows) {
    if (row.strike == null || (row.side !== "call" && row.side !== "put")) continue
    const pair = byStrike.get(row.strike) || {}
    pair[row.side] = row
    byStrike.set(row.strike, pair)
  }
  let chosen: { call: ContractRow; put: ContractRow; strike: number } | null = null
  if (strike != null) {
    for (const [rowStrike, pair] of byStrike) {
      if (pair.call && pair.put && sameStrike(rowStrike, strike)) {
        chosen = { call: pair.call, put: pair.put, strike: rowStrike }
        break
      }
    }
  }
  if (!chosen) {
    const spot = await publicQuery(
      `SELECT price FROM raw_option_minute
       WHERE underlying_key = $1 AND contract_id = 'SPOT'
       ORDER BY bar_time DESC LIMIT 1`,
      [key],
    )
    const spotPx = Number((spot.rows[0] as { price?: number } | undefined)?.price)
    let best = Infinity
    for (const [rowStrike, pair] of byStrike) {
      if (!pair.call || !pair.put) continue
      const dist = Number.isFinite(spotPx) ? Math.abs(rowStrike - spotPx) : 0
      if (dist < best) {
        best = dist
        chosen = { call: pair.call, put: pair.put, strike: rowStrike }
      }
    }
  }
  if (!chosen) return
  const asCapture = (row: ContractRow): CaptureContract => ({
    underlyingKey: key,
    contractId: row.contract_id,
    side: row.side as "call" | "put",
    monthCode: row.month_code,
    strike: row.strike,
    expireDay: row.expire_day,
    market: 221,
  })
  const pair = [asCapture(chosen.call), asCapture(chosen.put)]
  const minutes = key.endsWith("etf")
    ? await fetchEtfCaptureMinutes(pair, false)
    : await fetchCffexCaptureMinutes(pair)
  const spots = (key.endsWith("etf") ? await fetchEtfSpotMinutes(1) : await fetchCffexSpotMinutes(1)).filter(
    (row) => row.underlyingKey === key,
  )
  await upsertMinutes([...minutes, ...spots])
}

export async function readArchivedIv(args: {
  key: string
  month?: string | null
  strike?: number | null
  days: number
}): Promise<{ bars: OverlayPoint[]; contract: string; sessions: number } | null> {
  const days = Math.min(Math.max(Math.round(args.days) || 1, 1), 10)
  const monthArg = (args.month || "").trim().toUpperCase()
  const strikeArg = args.strike != null && args.strike > 0 ? args.strike : null
  const cacheId = `${args.key}|${monthArg}|${strikeArg ?? ""}|${days}`
  const hit = readCache.get(cacheId)
  if (hit && Date.now() - hit.at < 15_000) return hit.value

  try {
    await ensureSchema()
    const book = await publicQuery(
      `SELECT contract_id, side, month_code, strike, expire_day::text AS expire_day
       FROM raw_option_contract WHERE underlying_key = $1`,
      [args.key],
    )
    const contracts = book.rows as ContractRow[]
    const today = shanghaiParts().day
    const month = monthArg || pickFrontMonth(contracts, today)
    if (!month) return cache(cacheId, null)
    const tipKey = `${args.key}|${month}|${strikeArg ?? ""}`
    if (inCaptureWindow() && Date.now() - (tipAt.get(tipKey) || 0) > 60_000) {
      tipAt.set(tipKey, Date.now())
      await refreshTip(args.key, month, strikeArg).catch(() => undefined)
    }
    const monthRows = contracts.filter((row) => row.month_code.toUpperCase() === month.toUpperCase())
    const ids = [...monthRows.map((row) => row.contract_id), "SPOT"]
    const since = new Date(Date.now() - 18 * 86400_000)
    const printed = await publicQuery(
      `SELECT contract_id, bar_time, price
       FROM raw_option_minute
       WHERE underlying_key = $1 AND contract_id = ANY($2::text[]) AND bar_time >= $3
       ORDER BY bar_time`,
      [args.key, ids, since],
    )
    const minutes = printed.rows as MinuteRow[]
    const byId = new Map<string, MinuteRow[]>()
    for (const row of minutes) {
      const list = byId.get(row.contract_id) || []
      list.push(row)
      byId.set(row.contract_id, list)
    }
    const spotRows = byId.get("SPOT") || []
    const spotMap = new Map<string, number>()
    let fallbackSpot = 0
    for (const row of spotRows) {
      const at = row.bar_time instanceof Date ? row.bar_time : new Date(row.bar_time)
      const wall = wallOf(at)
      const price = Number(row.price)
      if (!(price > 0)) continue
      spotMap.set(`${wall.day} ${wall.hhmm}`, price)
      fallbackSpot = price
    }
    const byStrike = new Map<number, { call?: ContractRow; put?: ContractRow }>()
    for (const row of monthRows) {
      if (row.strike == null || (row.side !== "call" && row.side !== "put")) continue
      const pair = byStrike.get(row.strike) || {}
      pair[row.side] = row
      byStrike.set(row.strike, pair)
    }
    let chosen: { strike: number; call: ContractRow; put: ContractRow } | null = null
    if (strikeArg != null) {
      for (const [strike, pair] of byStrike) {
        if (pair.call && pair.put && sameStrike(strike, strikeArg)) {
          chosen = { strike, call: pair.call, put: pair.put }
          break
        }
      }
    } else {
      let best = Infinity
      for (const [strike, pair] of byStrike) {
        if (!pair.call || !pair.put) continue
        const dist = fallbackSpot > 0 ? Math.abs(strike - fallbackSpot) : 0
        if (dist < best) {
          best = dist
          chosen = { strike, call: pair.call, put: pair.put }
        }
      }
    }
    if (!chosen || !(fallbackSpot > 0)) return cache(cacheId, null)
    const toPoints = (id: string) =>
      (byId.get(id) || []).map((row) => {
        const at = row.bar_time instanceof Date ? row.bar_time : new Date(row.bar_time)
        const wall = wallOf(at)
        return { day: wall.day, hhmm: wall.hhmm, price: Number(row.price) }
      })
    const expireDay = chosen.call.expire_day || chosen.put.expire_day
    if (!expireDay) return cache(cacheId, null)
    let bars = ivBarsFromPair(
      toPoints(chosen.call.contract_id),
      toPoints(chosen.put.contract_id),
      spotMap,
      fallbackSpot || chosen.strike,
      chosen.strike,
      expireDay,
    )
    const daysKept: string[] = []
    const seen = new Set<string>()
    for (let i = bars.length - 1; i >= 0; i -= 1) {
      const key = dayKey(bars[i]!.time)
      if (seen.has(key)) continue
      seen.add(key)
      daysKept.push(key)
      if (daysKept.length >= days) break
    }
    const keep = new Set(daysKept)
    bars = bars.filter((bar) => keep.has(dayKey(bar.time)))
    if (bars.length < (days > 1 ? 2 : 8)) return cache(cacheId, null)
    return cache(cacheId, {
      bars,
      contract: pairLabel(args.key, month, chosen.strike, chosen.call.contract_id, chosen.put.contract_id),
      sessions: keep.size,
    })
  } catch (err) {
    console.error("[option-minute] read", err instanceof Error ? err.message : err)
    return cache(cacheId, null)
  }
}

function cache(
  id: string,
  value: { bars: OverlayPoint[]; contract: string; sessions: number } | null,
) {
  readCache.set(id, { at: value ? Date.now() : Date.now() - 12_000, value })
  return value
}
