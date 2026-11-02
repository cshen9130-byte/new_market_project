import { INDEX_FUTURES, type IndexProduct } from "@/lib/client/ctp-market"
import { INDEX_IV, type IvSnapshot, type OverlayPoint } from "@/lib/client/realtime-overlay"
import { query } from "@/lib/db"
import { fetchEtfAtmIvMinutes, etfAtmContractLabel } from "@/lib/server/atm-iv-minute"
import { cffexAtmContractLabel, fetchCffexAtmIvMinutes } from "@/lib/server/cffex-atm-iv-minute"
import { kickOptionMinuteCapture, readArchivedIv } from "@/lib/server/option-minute-archive"
import { chinaWallToUnix, SINA_UA, sinaGet } from "@/lib/server/sina-fetch"

function num(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Drop cliff-edge first prints (e.g. illiquid 09:30 ATM IV) before the series settles. */
function trimLeadingIvOutliers(bars: OverlayPoint[], maxRel = 0.06): OverlayPoint[] {
  if (bars.length < 3) return bars
  let i = 0
  while (i < bars.length - 1) {
    const cur = bars[i].close
    const next = bars[i + 1].close
    if (!(next > 0) || Math.abs(cur - next) / next <= maxRel) break
    i += 1
  }
  return i === 0 ? bars : bars.slice(i)
}


function wallDay(unix: number) {
  const d = new Date(unix * 1000)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

function todayShanghai() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

function parseCsv(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

/** Minute CSVs carry a clock and no date. Allow a short publisher delay, then treat anything later as the previous session. */
const UNDATED_FUTURE_GRACE_MIN = 3

function shanghaiClockMinutes(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now)
  const hour = Number(parts.find((part) => part.type === "hour")?.value)
  const minute = Number(parts.find((part) => part.type === "minute")?.value)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  return hour * 60 + minute
}

/** A minute tape reaches the cash close when its last print is 14:55 or later. */
export function barsReachCashClose(bars: Array<{ time: number }>) {
  const last = bars[bars.length - 1]
  if (!last) return false
  const clock = new Date(last.time * 1000)
  return clock.getUTCHours() * 60 + clock.getUTCMinutes() >= 14 * 60 + 55
}

/** CFFEX option session: 09:30–11:30 and 13:00–15:00, Shanghai weekdays. 15:00 itself is still the session. */
export function indexOptionSessionOpen(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now)
  const weekday = parts.find((part) => part.type === "weekday")?.value
  if (weekday === "Sat" || weekday === "Sun") return false
  const hour = Number(parts.find((part) => part.type === "hour")?.value)
  const minute = Number(parts.find((part) => part.type === "minute")?.value)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false
  const n = hour * 60 + minute
  return (n >= 9 * 60 + 30 && n <= 11 * 60 + 30) || (n >= 13 * 60 && n <= 15 * 60)
}

type MinuteSnap = { bars: Array<{ time: number; close: number }>; source?: string | null }

function underlyingKey(source: string | null | undefined) {
  if (!source?.includes(":")) return null
  const key = source.slice(source.indexOf(":") + 1)
  return key || null
}

function isForumMinute(source: string | null | undefined) {
  return !!source?.startsWith("optbbs:")
}

function isStoredSina(source: string | null | undefined) {
  return !!source && (source.startsWith("archive:") || source.startsWith("qvix-sina:") || source.startsWith("sina-atm:"))
}

/**
 * After the bell, keep the series that was already on the chart.
 * A fallback underlying (index options standing in for the ETF) may be
 * replaced by the primary series, and then that series stays.
 */
export function pickClosedSessionSnap<T extends MinuteSnap>(
  kept: T | null,
  next: T | null,
  primaryKey: string | null = null,
): { snap: T | null; frozen: boolean } {
  const nextKey = underlyingKey(next?.source)
  const keptKey = underlyingKey(kept?.source)
  if (isForumMinute(kept?.source) && isStoredSina(next?.source)) return { snap: next, frozen: true }
  if (
    next?.bars.length &&
    kept?.bars.length &&
    primaryKey &&
    nextKey === primaryKey &&
    keptKey &&
    keptKey !== primaryKey
  ) {
    return { snap: next, frozen: true }
  }
  // The delayed CFFEX file arrives after the close. Let that same tape grow
  // out to 15:00 instead of freezing the 14:47 prefix.
  if (
    next?.bars.length &&
    kept?.bars.length &&
    nextKey &&
    nextKey === keptKey &&
    !barsReachCashClose(kept.bars) &&
    (next.bars[next.bars.length - 1]?.time ?? 0) > (kept.bars[kept.bars.length - 1]?.time ?? 0)
  ) {
    return { snap: next, frozen: true }
  }
  if (kept?.bars.length) return { snap: kept, frozen: true }
  if (next?.bars.length) return { snap: next, frozen: true }
  return { snap: null, frozen: false }
}

/**
 * optbbs / Sina minute files have no date, and the parser stamps them with today.
 * chinaWallToUnix stores that wall clock in the UTC fields, so compare clock-of-day,
 * not Date.now(). A tape that already contains 15:00 while the clock is 10:36 is the
 * previous session and must not be drawn as today.
 */
export function undatedMinuteTapeIsStale(bars: OverlayPoint[], now = new Date()) {
  const nowMin = shanghaiClockMinutes(now)
  if (nowMin == null || bars.length === 0) return false
  const limit = nowMin + UNDATED_FUTURE_GRACE_MIN
  return bars.some((bar) => {
    const clock = new Date(bar.time * 1000)
    const mins = clock.getUTCHours() * 60 + clock.getUTCMinutes()
    return mins > limit
  })
}

function barsFromMinCsv(text: string): OverlayPoint[] {
  const lines = parseCsv(text)
  if (lines.length < 2) return []
  const header = lines[0].toLowerCase()
  const date = todayShanghai()
  const bars: OverlayPoint[] = []
  let undated = false
  for (const line of lines.slice(header.includes("time") || header.includes("date") ? 1 : 0)) {
    const parts = line.split(",").map((p) => p.trim())
    if (parts.length < 2) continue
    const stamp = parts[0]
    const close = num(parts[1])
    if (close == null || !(close > 0)) continue
    const rounded = Math.round(close * 100) / 100
    const timeOnly = !stamp.includes(" ") && /^\d{1,2}:\d{2}/.test(stamp)
    if (timeOnly) undated = true
    const day = timeOnly ? `${date} ${stamp}` : stamp
    const time = chinaWallToUnix(day.length === 16 ? `${day}:00` : day)
    if (time == null) continue
    bars.push({ time, close: rounded })
  }
  if (undated && undatedMinuteTapeIsStale(bars)) return []
  return bars
}

const OPTBBS_MIN_FILE: Record<string, string> = {
  "50etf": "vix50",
  "50index": "vix50index",
  "300etf": "vix300",
  "300index": "vixindex",
  "500etf": "vix500",
  "1000etf": "vix1000",
  "1000index": "vixindex1000",
}

/** Column indices in http://1.optbbs.com/d/csv/d/k.csv (akshare mapping). */
const OPTBBS_K_COLS: Record<string, [number, number, number, number]> = {
  "50etf": [1, 2, 3, 4],
  "300etf": [9, 10, 11, 12],
  "300index": [17, 18, 19, 20],
  "1000index": [25, 26, 27, 28],
  "500etf": [67, 68, 69, 70],
  "50index": [79, 80, 81, 82],
}

/** When 0/false/off, skip sina-atm / em-atm reconstruction (QVIX-only sources). Default: allow as last resort. */
function allowAtmFallback() {
  const raw = (process.env.QVIX_ALLOW_ATM_FALLBACK ?? "1").trim().toLowerCase()
  return !(raw === "0" || raw === "false" || raw === "off" || raw === "no")
}

/** When 1/true, demote reconstructed series to "近月平值" / em-atm|sina-atm tags. Default: keep QVIX branding (official feed is often #NAME? for index underlyings). */
function labelAtmExplicitly() {
  const raw = (process.env.QVIX_LABEL_ATM ?? "0").trim().toLowerCase()
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes"
}

async function fetchText(url: string, referer: string) {
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(4000),
    headers: {
      "User-Agent": SINA_UA,
      Referer: referer,
    },
  })
  if (!res.ok) throw new Error(`${url} ${res.status}`)
  return res.text()
}

async function fetchOptbbsMin(code: string) {
  const file = OPTBBS_MIN_FILE[code] || code
  const paths = [
    `http://1.optbbs.com/d/csv/d/${file}.csv`,
    `https://1.optbbs.com/d/csv/d/${file}.csv`,
    `https://1.optbbs.com/d/csv/data/${code}.min.csv`,
  ]
  let lastErr: Error | null = null
  for (const url of paths) {
    try {
      const text = await fetchText(url, "http://1.optbbs.com/s/vix.shtml")
      const bars = barsFromMinCsv(text)
      if (bars.length >= 8) return bars
      if (/time|qvix/i.test(text.slice(0, 80))) return []
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
    }
  }
  throw lastErr || new Error(`optbbs ${code} empty`)
}

async function fetchOptbbsDailyLast(code: string) {
  const file = OPTBBS_MIN_FILE[code]
  const urls = file
    ? [`http://1.optbbs.com/d/csv/d/${file}.csv`, `https://1.optbbs.com/d/csv/data/${code}.csv`]
    : [`https://1.optbbs.com/d/csv/data/${code}.csv`]
  for (const url of urls) {
    try {
      const lines = parseCsv(await fetchText(url, "http://1.optbbs.com/s/vix.shtml"))
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const parts = lines[i].split(",")
        const close = num(parts[parts.length === 2 ? 1 : 4] ?? parts[1])
        const stamp = parts[0]?.trim() || ""
        const time = /\d{4}-\d{2}-\d{2}/.test(stamp)
          ? chinaWallToUnix(stamp.includes(" ") ? stamp : `${stamp} 15:00:00`)
          : chinaWallToUnix(`${todayShanghai()} ${/^\d{1,2}:\d{2}/.test(stamp) ? stamp : "15:00:00"}`)
        if (close != null && time != null) return { close, time, date: stamp }
      }
    } catch {
      // try next url
    }
  }
  return null
}


async function fetchOptbbsKDaily(code: string): Promise<OverlayPoint[]> {
  const cols = OPTBBS_K_COLS[code]
  if (!cols) return []
  try {
    const text = await fetchText("http://1.optbbs.com/d/csv/d/k.csv", "http://1.optbbs.com/s/vix.shtml")
    const lines = parseCsv(text)
    if (lines.length < 2) return []
    const bars: OverlayPoint[] = []
    for (const line of lines.slice(1)) {
      const parts = line.split(",")
      const dayRaw = (parts[0] || "").trim().replace(/\//g, "-")
      const day = dayRaw.length >= 10 ? dayRaw.slice(0, 10) : ""
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
      const close = num(parts[cols[3]])
      if (close == null || !(close > 0)) continue
      const time = chinaWallToUnix(`${day} 15:00:00`)
      if (time == null) continue
      bars.push({ time, close: Math.round(close * 100) / 100 })
    }
    return bars
  } catch {
    return []
  }
}

async function fetchSinaQvixMin(symbol: string) {
  const text = await sinaGet(
    `https://stock.finance.sina.com.cn/futures/api/openapi.php/StockOptionServiceService.getUndelayMinLine?symbol=${encodeURIComponent(symbol)}`,
    "https://stock.finance.sina.com.cn/option/quotes.html",
  )
  const json = JSON.parse(text) as {
    result?: { data?: { minLine?: Array<Array<string | number>> } }
  }
  const rows = json.result?.data?.minLine || []
  const date = todayShanghai()
  const bars: OverlayPoint[] = []
  for (const row of rows) {
    const hhmm = String(row[0] || "")
    const close = num(row[1])
    const time = chinaWallToUnix(`${date} ${hhmm.length === 5 ? `${hhmm}:00` : hhmm}`)
    if (time == null || close == null) continue
    bars.push({ time, close })
  }
  if (undatedMinuteTapeIsStale(bars)) return []
  return bars
}

const SINA_QVIX_SYMBOL: Record<string, string> = {
  "50etf": "50ETF",
  "50index": "50ETF",
  "300etf": "300ETF",
  "300index": "300ETF",
  "500etf": "500ETF",
  "1000etf": "1000ETF",
  "1000index": "1000ETF",
}

let dailyCache: { at: number; byKey: Record<string, OverlayPoint[]> } | null = null
const DAILY_TTL_MS = 5 * 60_000

export async function getQvixDailyBars(product: IndexProduct): Promise<OverlayPoint[]> {
  const meta = INDEX_IV[product]
  const primary = await fetchQvixDailyFromDb(meta.key)
  if (primary.length >= 2 || meta.fallback === meta.key) return primary
  const fallback = await fetchQvixDailyFromDb(meta.fallback)
  return fallback.length >= 2 ? fallback : primary
}

async function fetchQvixDailyFromDb(key: string): Promise<OverlayPoint[]> {
  if (dailyCache && Date.now() - dailyCache.at < DAILY_TTL_MS) {
    return dailyCache.byKey[key] || []
  }
  try {
    const rows = await query<{ trade_date: string; underlying_key: string; iv: string | number }>(
      `SELECT trade_date::text AS trade_date, underlying_key, iv
       FROM raw_option_iv_qvix_daily
       WHERE underlying_key IN ('50etf','50index','300etf','300index','500etf','1000index','1000etf')
         AND iv IS NOT NULL AND iv > 0
       ORDER BY trade_date ASC`,
    )
    const byKey: Record<string, OverlayPoint[]> = {}
    for (const row of rows) {
      const close = num(row.iv)
      const day = String(row.trade_date).slice(0, 10)
      const time = chinaWallToUnix(`${day} 15:00:00`)
      if (close == null || time == null) continue
      const list = byKey[row.underlying_key] || (byKey[row.underlying_key] = [])
      list.push({ time, close })
    }
    dailyCache = { at: Date.now(), byKey }
    return byKey[key] || []
  } catch {
    return dailyCache?.byKey[key] || []
  }
}

async function fetchOptbbsPre(code: string): Promise<number | null> {
  const file = OPTBBS_MIN_FILE[code] || code
  try {
    const text = await fetchText(`http://1.optbbs.com/d/csv/d/${file}.csv`, "http://1.optbbs.com/s/vix.shtml")
    for (const line of parseCsv(text).slice(1)) {
      const pre = num(line.split(",")[2])
      if (pre != null && pre > 0) return pre
    }
  } catch {
    return null
  }
  return null
}

function sourceFamily(source: string | null | undefined) {
  if (!source) return "none"
  if (source.startsWith("optbbs:")) return "optbbs"
  if (source === "sina") return "sina"
  if (source.startsWith("qvix-sina:") || source.startsWith("sina-atm:")) return "sina-atm"
  if (source.startsWith("qvix-cffex:") || source.startsWith("em-atm:")) return "cffex-atm"
  if (source.startsWith("archive:")) return "archive"
  if (source.startsWith("optbbs-k:")) return "optbbs-k"
  if (source.startsWith("db:")) return "db"
  if (source.startsWith("optbbs-pre:")) return "optbbs-pre"
  if (source.startsWith("optbbs-daily:")) return "optbbs-daily"
  return source.split(":")[0] || source
}

function codeFromSource(source: string | null) {
  if (!source || !source.includes(":")) return null
  const code = source.slice(source.indexOf(":") + 1)
  if (!code || /^\d+d$/.test(code)) return null
  return code
}

async function pairForCode(code: string | null | undefined, month?: string | null) {
  if (!code) return null
  try {
    const etf = await etfAtmContractLabel(code)
    if (etf) return etf
    return await cffexAtmContractLabel(code, month)
  } catch {
    return null
  }
}

async function loadIvFromFamily(
  product: IndexProduct,
  family: string,
): Promise<{ bars: OverlayPoint[]; source: string | null; contract: string | null } | null> {
  const meta = INDEX_IV[product]
  const codes = [...new Set([meta.key, meta.fallback])]
  const explicit = labelAtmExplicitly()
  if (family === "optbbs") {
    for (const code of codes) {
      try {
        const bars = await fetchOptbbsMin(code)
        if (bars.length >= 8) return { bars, source: `optbbs:${code}`, contract: null }
      } catch {
        // try next
      }
    }
    return null
  }
  if (family === "sina") {
    try {
      const bars = await fetchSinaQvixMin(SINA_QVIX_SYMBOL[meta.key] || "50ETF")
      if (bars.length >= 8) return { bars, source: "sina", contract: null }
    } catch {
      return null
    }
    return null
  }
  if (family === "sina-atm") {
    if (!allowAtmFallback()) return null
    for (const code of codes) {
      const live = await fetchEtfAtmIvMinutes(code)
      if (live && live.bars.length >= 8) {
        return { bars: live.bars, source: explicit ? `sina-atm:${code}` : `qvix-sina:${code}`, contract: live.contract || null }
      }
    }
    return null
  }
  if (family === "cffex-atm") {
    if (!allowAtmFallback()) return null
    for (const code of codes) {
      const live = await fetchCffexAtmIvMinutes(code)
      if (live && live.bars.length >= 8) {
        return { bars: live.bars, source: explicit ? `em-atm:${code}` : `qvix-cffex:${code}`, contract: live.contract || null }
      }
    }
    return null
  }
  if (family === "archive") {
    for (const code of codes) {
      const archived = await readArchivedIv({ key: code, days: 1 })
      if (archived && archived.bars.length >= 8) {
        return { bars: archived.bars, source: `archive:${code}`, contract: archived.contract }
      }
    }
    return null
  }
  return null
}

async function loadIv(product: IndexProduct, preferFamily?: string | null): Promise<IvSnapshot> {
  const meta = INDEX_IV[product]
  const codes = [...new Set([meta.key, meta.fallback])]
  let bars: OverlayPoint[] = []
  let source: string | null = null
  let contract: string | null = null

  // After the close, use the minutes already stored in Postgres.
  // ETF tapes are complete. The 中证1000 tape is the delayed CFFEX file, so a
  // copy that stops before 14:55 is replaced by a fresh read that includes 15:00.
  if (!indexOptionSessionOpen()) {
    const archived = await readArchivedIv({ key: meta.key, days: 1 })
    const today = todayShanghai()
    const stored = archived?.bars.filter((bar) => wallDay(bar.time) === today) ?? []
    const indexTape = meta.key.endsWith("index")
    if (stored.length >= 8 && archived && (!indexTape || barsReachCashClose(stored))) {
      bars = stored
      contract = archived.contract
      source = `archive:${meta.key}`
    } else if (indexTape) {
      const live = await fetchCffexAtmIvMinutes(meta.key)
      const liveBars = (live?.bars || []).filter((bar) => wallDay(bar.time) === today)
      if (live && liveBars.length >= 8) {
        bars = liveBars
        contract = live.contract || null
        source = labelAtmExplicitly() ? `em-atm:${meta.key}` : `qvix-cffex:${meta.key}`
      } else if (stored.length >= 8 && archived) {
        bars = stored
        contract = archived.contract
        source = `archive:${meta.key}`
      }
    } else {
      const etf = await fetchEtfAtmIvMinutes(meta.key)
      if (etf && etf.bars.length >= 8) {
        bars = etf.bars
        contract = etf.contract || null
        source = labelAtmExplicitly() ? `sina-atm:${meta.key}` : `qvix-sina:${meta.key}`
      }
    }
  }

  // Stick to the previously established minute source so flaky optbbs vs ATM
  // rebuild do not alternate chart shapes every poll.
  if (bars.length < 8 && preferFamily && preferFamily !== "none") {
    const sticky = await loadIvFromFamily(product, preferFamily)
    if (sticky && sticky.bars.length >= 8) {
      bars = sticky.bars
      source = sticky.source
      contract = sticky.contract
    }
  }

  if (bars.length < 8 && indexOptionSessionOpen()) {
  for (const code of codes) {
    try {
      bars = await fetchOptbbsMin(code)
      if (bars.length >= 8) {
        source = `optbbs:${code}`
        break
      }
      bars = []
    } catch {
      // try next
    }
  }
  }
  if (bars.length < 8) {
    try {
      bars = await fetchSinaQvixMin(SINA_QVIX_SYMBOL[meta.key] || "50ETF")
      if (bars.length) source = "sina"
    } catch {
      // ignore
    }
  }
  // Minute reconstruction (QVIX == near-month ATM IV). Official optbbs index CSVs are often #NAME?.
  // Keep QVIX branding by default; set QVIX_LABEL_ATM=1 for explicit em-atm/sina-atm demotion.
  // Set QVIX_ALLOW_ATM_FALLBACK=0 to disable reconstruction entirely.
  if (bars.length < 8 && allowAtmFallback()) {
    const atmKeys = [...new Set([meta.key, meta.fallback])]
    const explicit = labelAtmExplicitly()
    for (const code of atmKeys) {
      const live = await fetchEtfAtmIvMinutes(code)
      if (live && live.bars.length >= 8) {
        bars = live.bars
        contract = live.contract || null
        source = explicit ? `sina-atm:${code}` : `qvix-sina:${code}`
        break
      }
    }
    if (bars.length < 8) {
      for (const code of atmKeys) {
        const live = await fetchCffexAtmIvMinutes(code)
        if (live && live.bars.length >= 8) {
          bars = live.bars
          contract = live.contract || null
          source = explicit ? `em-atm:${code}` : `qvix-cffex:${code}`
          break
        }
      }
    }
    if (bars.length < 8) {
      for (const code of atmKeys) {
        const archived = await readArchivedIv({ key: code, days: 1 })
        if (archived && archived.bars.length >= 8) {
          bars = archived.bars
          contract = archived.contract
          source = `archive:${code}`
          break
        }
      }
    }
  }
  if (bars.length >= 8) bars = trimLeadingIvOutliers(bars)

  // Daily real QVIX from optbbs k.csv (when minute feeds are blank).
  if (bars.length < 8) {
    for (const code of codes) {
      const daily = await fetchOptbbsKDaily(code)
      if (daily.length >= 8) {
        bars = daily.slice(-120)
        source = `optbbs-k:${code}`
        break
      }
    }
  }
  if (bars.length < 8) {
    for (const code of codes) {
      const daily = await fetchQvixDailyFromDb(code)
      if (daily.length >= 2) {
        bars = daily.slice(-90)
        source = `db:${code}`
        break
      }
    }
  }

  if (bars.length < 2) {
    for (const code of codes) {
      const pre = await fetchOptbbsPre(code)
      if (pre == null) continue
      const openT = chinaWallToUnix(`${todayShanghai()} 09:30:00`)
      const closeT = chinaWallToUnix(`${todayShanghai()} 15:00:00`)
      if (openT != null && closeT != null) {
        bars = [
          { time: openT, close: pre },
          { time: closeT, close: pre },
        ]
        source = `optbbs-pre:${code}`
        break
      }
    }
  }
  let value = bars.at(-1)?.close ?? null
  if (value == null) {
    for (const code of codes) {
      try {
        const last = await fetchOptbbsDailyLast(code)
        if (last) {
          value = last.close
          source = `optbbs-daily:${code}`
          bars = [{ time: last.time, close: last.close }]
          break
        }
      } catch {
        // ignore
      }
    }
  }
  if (!contract) contract = await pairForCode(codeFromSource(source) || meta.key)
  const liveDay = bars.at(-1) ? wallDay(bars.at(-1)!.time) : todayShanghai()
  let prevClose: number | null = null
  try {
    const daily = await getQvixDailyBars(product)
    for (let i = daily.length - 1; i >= 0; i -= 1) {
      const close = daily[i]!.close
      if (!(close > 0) || !(wallDay(daily[i]!.time) < liveDay)) continue
      prevClose = close
      break
    }
  } catch {
    prevClose = null
  }
  const prev = bars.length < 2
    ? null
    : source?.startsWith("db:") || source?.startsWith("optbbs-k:")
      ? bars[bars.length - 2]?.close ?? null
      : bars[0].close
  const change = value != null && prev != null ? value - prev : null
  const pct = change != null && prev ? (change / prev) * 100 : null
  return {
    product,
    key: meta.key,
    option: meta.option,
    name: source?.startsWith("sina-atm:") || source?.startsWith("em-atm:") ? meta.name.replace(/ QVIX$/, "近月平值") : meta.name,
    value,
    change,
    pct,
    prevClose,
    source,
    contract,
    bars,
  }
}

let inflight: Promise<Record<IndexProduct, IvSnapshot>> | null = null
let cached: { at: number; data: Record<IndexProduct, IvSnapshot> } | null = null
const lastGoodMinute: Map<IndexProduct, { at: number; snap: IvSnapshot }> =
  (globalThis as { __qvixLastGoodMinute?: Map<IndexProduct, { at: number; snap: IvSnapshot }> }).__qvixLastGoodMinute ??
  ((globalThis as { __qvixLastGoodMinute?: Map<IndexProduct, { at: number; snap: IvSnapshot }> }).__qvixLastGoodMinute = new Map())
const closedSessionFrozen = new Set<IndexProduct>()
const TTL_MS = 3000
const KEEP_MINUTE_MS = 120_000

function isMinuteIv(snap: IvSnapshot) {
  return (
    !!snap.source &&
    (snap.source.startsWith("optbbs:") ||
      snap.source === "sina" ||
      snap.source.startsWith("qvix-sina:") ||
      snap.source.startsWith("qvix-cffex:") ||
      snap.source.startsWith("sina-atm:") ||
      snap.source.startsWith("em-atm:") ||
      snap.source.startsWith("archive:")) &&
    snap.bars.length >= 8
  )
}

export async function getQvixRealtime() {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data
  if (inflight) return inflight
  inflight = (async () => {
    kickOptionMinuteCapture()
    const now = Date.now()
    const sessionOpen = indexOptionSessionOpen()
    const rows = await Promise.all(
      INDEX_FUTURES.map((item) => {
        const kept = lastGoodMinute.get(item.product)
        const keptFamily = kept ? sourceFamily(kept.snap.source) : null
        // After the close, don't stick to the index-option fallback. Walk the
        // normal order so the ETF series can come back.
        const prefer =
          sessionOpen && kept && now - kept.at < KEEP_MINUTE_MS && isMinuteIv(kept.snap) && keptFamily !== "archive"
            ? keptFamily
            : null
        return loadIv(item.product, prefer)
      }),
    )
    const sticky = rows.map((row) => {
      if (!sessionOpen) {
        const kept = lastGoodMinute.get(row.product)
        const picked = pickClosedSessionSnap(
          kept && isMinuteIv(kept.snap) ? kept.snap : null,
          isMinuteIv(row) ? row : null,
          INDEX_IV[row.product].key,
        )
        if (picked.frozen) closedSessionFrozen.add(row.product)
        if (picked.snap) {
          lastGoodMinute.set(row.product, { at: now, snap: picked.snap })
          return picked.snap
        }
        return row
      }
      closedSessionFrozen.delete(row.product)
      if (isMinuteIv(row)) {
        const kept = lastGoodMinute.get(row.product)
        // Refuse mid-session source flip-flops that rewrite the whole shape.
        if (
          kept &&
          now - kept.at < KEEP_MINUTE_MS &&
          isMinuteIv(kept.snap) &&
          sourceFamily(kept.snap.source) !== sourceFamily(row.source)
        ) {
          // A stored minute line can fill a dead live feed, then give the chart back when live returns.
          if (sourceFamily(kept.snap.source) === "archive" && sourceFamily(row.source) !== "archive") {
            lastGoodMinute.set(row.product, { at: now, snap: row })
            return row
          }
          return kept.snap
        }
        lastGoodMinute.set(row.product, { at: now, snap: row })
        return row
      }
      const kept = lastGoodMinute.get(row.product)
      if (kept && now - kept.at < KEEP_MINUTE_MS) return kept.snap
      return row
    })
    const data = Object.fromEntries(sticky.map((row) => [row.product, row])) as Record<
      IndexProduct,
      IvSnapshot
    >
    cached = { at: Date.now(), data }
    return data
  })()
  try {
    return await inflight
  } finally {
    inflight = null
  }
}
