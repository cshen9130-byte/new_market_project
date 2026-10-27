/**
 * Official CFFEX daily settlement (今结算) from exchange CSV.
 * URL: http://www.cffex.com.cn/sj/hqsj/rtj/{YYYYMM}/{DD}/{YYYYMMDD}_1.csv
 * Encoding: GBK. Columns: 合约代码,...,今收盘,今结算,前结算,...
 */

export type CffexDailySettleRow = {
  symbol: string
  close: number | null
  settlement: number | null
  preSettlement: number | null
}

export type CffexDailySettleBundle = {
  asOf: string
  rows: Record<string, CffexDailySettleRow>
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

function shanghaiYmd(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
}

function ymdToCompact(ymd: string) {
  return ymd.replace(/-/g, "")
}

function num(value: string | undefined) {
  if (value == null) return null
  const t = value.trim()
  if (!t || t === "-" || t === "--" || t.toLowerCase() === "null") return null
  const n = Number(t.replace(/,/g, ""))
  return Number.isFinite(n) ? n : null
}

function decodeGbk(buf: ArrayBuffer) {
  return new TextDecoder("gbk").decode(buf)
}

function cffexDailyUrl(ymd: string) {
  const compact = ymdToCompact(ymd)
  const ym = compact.slice(0, 6)
  const dd = compact.slice(6, 8)
  return `http://www.cffex.com.cn/sj/hqsj/rtj/${ym}/${dd}/${compact}_1.csv`
}

function priorShanghaiYmd(ymd: string, back = 1) {
  const [y, m, d] = ymd.split("-").map(Number)
  const utc = Date.UTC(y, m - 1, d) - back * 24 * 60 * 60 * 1000
  return shanghaiYmd(new Date(utc))
}

function parseCffexDailyCsv(text: string): Record<string, CffexDailySettleRow> {
  const out: Record<string, CffexDailySettleRow> = {}
  const lines = text.split(/\r?\n/)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const parts = line.split(",")
    if (parts.length < 11) continue
    const symbol = parts[0].trim().toUpperCase()
    if (!symbol || symbol === "小计" || symbol === "合计") continue
    // Index / bond futures only (skip options like HO2611-C-2450)
    if (!/^(IH|IF|IC|IM|T|TF|TS|TL)\d{4}$/.test(symbol)) continue
    out[symbol] = {
      symbol,
      close: num(parts[8]),
      settlement: num(parts[9]),
      preSettlement: num(parts[10]),
    }
  }
  return out
}

async function fetchDailyForDate(ymd: string): Promise<CffexDailySettleBundle | null> {
  const url = cffexDailyUrl(ymd)
  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      "User-Agent": UA,
      Referer: "http://www.cffex.com.cn/",
    },
  })
  if (!res.ok) return null
  const buf = await res.arrayBuffer()
  const text = decodeGbk(buf)
  if (!text.trim() || /<html/i.test(text) || text.includes("网页错误")) return null
  const rows = parseCffexDailyCsv(text)
  if (!Object.keys(rows).length) return null
  return { asOf: ymd, rows }
}

let inflight: Promise<CffexDailySettleBundle | null> | null = null
let cached: { at: number; key: string; data: CffexDailySettleBundle | null } | null = null
const TTL_MS = 5 * 60_000

/**
 * Prefer preferYmd (table as-of). Walk back a few Shanghai calendar days if
 * today's CSV is not published yet (pre-close / weekends / holidays).
 */
export async function getCffexDailySettles(preferYmd?: string | null) {
  const want = preferYmd && /^\d{4}-\d{2}-\d{2}$/.test(preferYmd) ? preferYmd : shanghaiYmd()
  if (cached && cached.key === want && Date.now() - cached.at < TTL_MS) return cached.data
  if (inflight) return inflight

  inflight = (async () => {
    let last: CffexDailySettleBundle | null = null
    for (let back = 0; back < 6; back++) {
      const ymd = back === 0 ? want : priorShanghaiYmd(want, back)
      try {
        const bundle = await fetchDailyForDate(ymd)
        if (bundle) {
          last = bundle
          break
        }
      } catch {
        // try older day
      }
    }
    cached = { at: Date.now(), key: want, data: last }
    return last
  })().finally(() => {
    inflight = null
  })

  return inflight
}

export function settlementMapFromBundle(bundle: CffexDailySettleBundle | null) {
  const map: Record<string, number> = {}
  if (!bundle) return map
  for (const [symbol, row] of Object.entries(bundle.rows)) {
    if (row.settlement != null && row.settlement > 0) map[symbol] = row.settlement
  }
  return map
}
