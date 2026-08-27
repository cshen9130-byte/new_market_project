import { assetFromContract } from "@/lib/all-weather/universe"
import { CFFEX_BOND_PRODUCTS, CFFEX_INDEX_PRODUCTS } from "@/lib/client/cffex-expiry"
import { applyDeeperBook, mergeQuoteTicks, type CtpTick } from "@/lib/client/ctp-market"

const CFFEX = new Set<string>([...CFFEX_INDEX_PRODUCTS, ...CFFEX_BOND_PRODUCTS])

/** 鸡蛋 / 生猪 / 苹果 / 红枣等：无夜盘。 */
const NO_NIGHT = new Set(["JD", "LH", "AP", "CJ", "RI", "JR", "LR", "WH", "PM", "RS", "FB", "BB"])
/** 黄金、白银、原油、低硫燃油：21:00–02:30。 */
const NIGHT_TO_0230 = new Set(["AU", "AG", "SC", "LU"])
/** 上期所 / 国际铜等有色：21:00–01:00。碳酸锂 LC 是大商所 23:00，不要放这里。 */
const NIGHT_TO_0100 = new Set(["CU", "AL", "ZN", "PB", "NI", "SN", "AO", "BC", "SS", "AD"])

function shanghaiParts(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Shanghai",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  )
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday)
  const hhmm = Number(parts.hour) * 100 + Number(parts.minute)
  return { weekday: weekday < 0 ? now.getDay() : weekday, hhmm }
}

function inRange(hhmm: number, start: number, end: number) {
  return hhmm >= start && hhmm <= end
}

export function shanghaiYmd(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
}

function nextWeekdayYmd(ymd: string) {
  const [year, month, day] = ymd.split("-").map(Number)
  const dt = new Date(Date.UTC(year, month - 1, day))
  for (let i = 0; i < 8; i++) {
    dt.setUTCDate(dt.getUTCDate() + 1)
    const week = dt.getUTCDay()
    if (week !== 0 && week !== 6) {
      return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`
    }
  }
  return ymd
}

export function productCodeOf(symbol?: string | null) {
  if (!symbol) return ""
  return (assetFromContract(symbol) || symbol.replace(/\d+$/i, "") || symbol).toUpperCase()
}

function nightEndHhmm(symbol?: string | null) {
  const asset = productCodeOf(symbol)
  if (NIGHT_TO_0230.has(asset)) return 230
  if (NIGHT_TO_0100.has(asset)) return 100
  return 2300
}

export function hasNightSession(symbol?: string | null) {
  if (!symbol || isCffexProduct(symbol)) return false
  return !NO_NIGHT.has(productCodeOf(symbol))
}

export function isNightWallClock(now = new Date(), symbol?: string | null) {
  if (!hasNightSession(symbol)) return false
  const { weekday, hhmm } = shanghaiParts(now)
  const nightEnd = nightEndHhmm(symbol)
  if (weekday >= 1 && weekday <= 5 && hhmm >= 2100) return true
  if (nightEnd < 2100 && weekday >= 2 && weekday <= 6 && inRange(hhmm, 0, nightEnd)) return true
  return false
}

/** CFFEX 股指/国债：仅工作日日盘。 */
export function isCffexSession(now = new Date()) {
  const { weekday, hhmm } = shanghaiParts(now)
  if (weekday === 0 || weekday === 6) return false
  return inRange(hhmm, 930, 1130) || inRange(hhmm, 1300, 1515)
}

/**
 * 国内商品：周日全天休市。夜盘只在周一至周五晚上，周五夜盘跨到周六凌晨后收市到周一早盘。
 */
export function isCommoditySession(now = new Date(), symbol?: string) {
  const { weekday, hhmm } = shanghaiParts(now)
  if (weekday === 0 || weekday === 6) {
    const nightEnd = nightEndHhmm(symbol)
    return hasNightSession(symbol) && nightEnd < 2100 && weekday === 6 && inRange(hhmm, 0, nightEnd)
  }
  if (hasNightSession(symbol)) {
    const nightEnd = nightEndHhmm(symbol)
    if (weekday >= 1 && weekday <= 5 && hhmm >= 2100) {
      return nightEnd >= 2300 ? hhmm <= nightEnd : true
    }
    if (nightEnd < 2100 && weekday >= 2 && weekday <= 6 && inRange(hhmm, 0, nightEnd)) return true
  }
  return inRange(hhmm, 900, 1015) || inRange(hhmm, 1030, 1130) || inRange(hhmm, 1330, 1500)
}

export function isCffexProduct(symbol: string) {
  const asset = productCodeOf(symbol)
  return CFFEX.has(asset)
}

export function isLiveSessionFor(symbol: string, now = new Date()) {
  return isCffexProduct(symbol) ? isCffexSession(now) : isCommoditySession(now, symbol)
}

/**
 * 商品日线交易日：仅对有夜盘的品种，夜盘起算下一交易日（周五夜盘→下周一）。
 * 股指/国债/无夜盘品种返回上海日历日。
 */
export function futuresTradeDateYmd(symbol: string, now = new Date()) {
  const ymd = shanghaiYmd(now)
  if (!hasNightSession(symbol)) return ymd
  const { weekday, hhmm } = shanghaiParts(now)
  const nightEnd = nightEndHhmm(symbol)
  if (weekday >= 1 && weekday <= 5 && hhmm >= 2100) return nextWeekdayYmd(ymd)
  if (nightEnd < 2100 && weekday >= 2 && weekday <= 6 && inRange(hhmm, 0, nightEnd)) {
    return weekday === 6 ? nextWeekdayYmd(ymd) : ymd
  }
  return ymd
}

export function quoteClockHhmm(quote?: { update_time?: string | null } | null) {
  const raw = String(quote?.update_time || "").trim()
  if (!raw) return null
  const colon = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (colon) return Number(colon[1]) * 100 + Number(colon[2])
  const digits = raw.replace(/\D/g, "")
  if (digits.length === 5 || digits.length === 6) {
    const s = digits.padStart(6, "0")
    const hh = Number(s.slice(0, 2))
    const mm = Number(s.slice(2, 4))
    if (hh <= 23 && mm <= 59) return hh * 100 + mm
  }
  return null
}

/** Exchange clock including seconds + millis, for picking the fresher last. */
export function quoteClockMs(quote?: { update_time?: string | null; update_millis?: number | null } | null) {
  const raw = String(quote?.update_time || "").trim()
  if (!raw) return null
  const colon = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  const millis = Number(quote?.update_millis) || 0
  if (colon) {
    const hh = Number(colon[1])
    const mm = Number(colon[2])
    const ss = Number(colon[3] || 0)
    return ((hh * 3600 + mm * 60 + ss) * 1000) + millis
  }
  const hhmm = quoteClockHhmm(quote)
  if (hhmm == null) return null
  const hh = Math.floor(hhmm / 100)
  const mm = hhmm % 100
  return ((hh * 3600 + mm * 60) * 1000) + millis
}

/** 夜盘时段里，行情时间仍停在 15:00 说明该合约今晚没成交，不能当成新交易日 K 线。 */
export function isNightHqPrint(symbol: string, quote?: { update_time?: string | null } | null) {
  if (!hasNightSession(symbol)) return false
  const hhmm = quoteClockHhmm(quote)
  if (hhmm == null) return false
  const nightEnd = nightEndHhmm(symbol)
  if (hhmm >= 2100) return true
  return nightEnd < 2100 && hhmm <= nightEnd
}

export function validMark(n: number | null | undefined) {
  return n != null && Number.isFinite(n) && n > 0 ? n : null
}

/** Keep live CTP last. Sina only fills a gap or a frozen SimNow clock. */
export function overlaySinaQuote(
  symbol: string,
  prev?: CtpTick | null,
  sina?: CtpTick | null,
): CtpTick | undefined {
  const key = symbol.toUpperCase()
  const ctpLast = validMark(prev?.last)
  const sinaLast = validMark(sina?.last)
  if (sinaLast == null) return prev ?? sina ?? undefined
  const sinaTick: CtpTick = { ...sina!, symbol: key, last: sinaLast }
  if (!prev) return sinaTick

  const live = isLiveSessionFor(key)
  const ctpMs = quoteClockMs(prev)
  const sinaMs = quoteClockMs(sina)
  const ctpFresh = live && ctpLast != null && (sinaMs == null || ctpMs == null || ctpMs >= sinaMs)
  if (ctpFresh) {
    return applyDeeperBook(
      {
        ...prev,
        symbol: key,
        last: ctpLast,
        pre_settlement: prev.pre_settlement ?? sina.pre_settlement,
        pre_close: prev.pre_close ?? sina.pre_close,
      },
      sinaTick,
    )
  }

  return applyDeeperBook(
    {
      ...mergeQuoteTicks(prev, sinaTick),
      last: sinaLast,
      open: sinaTick.open ?? prev.open,
      high: sinaTick.high ?? prev.high,
      low: sinaTick.low ?? prev.low,
      volume: sinaTick.volume ?? prev.volume,
      open_interest: sinaTick.open_interest ?? prev.open_interest,
      pre_settlement: sinaTick.pre_settlement ?? prev.pre_settlement,
      pre_close: sinaTick.pre_close ?? prev.pre_close,
      trade_date: sinaTick.trade_date ?? prev.trade_date,
      update_time: sinaTick.update_time ?? prev.update_time,
    },
    sinaTick,
  )
}

/** @deprecated use overlaySinaQuote — SimNow is stale for commodities and often for CFFEX too. */
export const overlayCommoditySinaQuote = overlaySinaQuote

export function quoteOf<T>(quotes: Record<string, T>, symbol: string): T | null {
  return quotes[symbol] || quotes[symbol.toUpperCase()] || quotes[symbol.toLowerCase()] || null
}

/** Keep the first closed-session mark. Only follow new prints while that product is in session. */
export function mergeClosedMarks(prev: Record<string, number>, incoming: Record<string, number>) {
  const next = { ...prev }
  let changed = false
  for (const [sym, px] of Object.entries(incoming)) {
    if (!validMark(px)) continue
    const key = sym.toUpperCase()
    if (!isLiveSessionFor(key) && validMark(next[key])) continue
    if (next[key] !== px) {
      next[key] = px
      changed = true
    }
  }
  return changed ? next : prev
}
