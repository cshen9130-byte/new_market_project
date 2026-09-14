import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { addIsoDays, type MarketEvent, type MarketEventCategory, type MarketEventImpact, type MarketEventRegion, type MarketEventSeries } from "@/lib/ma/market-event-calendar-shared"
import { listMarketEvents } from "@/lib/ma/market-event-calendar"
import { shanghaiTodayIsoDate } from "@/lib/server/china-trading-calendar"

const CACHE_DIR = join(process.cwd(), "data", "market-events-cache")
const CACHE_FILE = join(CACHE_DIR, "wscn.json")
const WSCN_URL = "https://api-one-wscn.awtmt.com/apiv1/finance/macrodatas"
const WEEK_MS = 7 * 24 * 3600 * 1000

type WscnRow = {
  id?: number | string
  public_date?: number | string
  country?: string
  country_id?: string
  title?: string
  event?: string
  importance?: number | string
  calendar_type?: string
  actual?: string
  forecast?: string
  previous?: string
  revised?: string
}

type LiveCache = {
  fetchedAt: string
  shanghaiDate: string
  from: string
  to: string
  rows: WscnRow[]
}

const CORE_COUNTRIES = new Set(["CN", "US", "JP", "DE", "FR", "IT", "ES", "EZ", "EU", "EA", "GB", "HK"])

const REGION_BY_ID: Record<string, MarketEventRegion> = {
  CN: "CN",
  HK: "CN",
  TW: "CN",
  US: "US",
  JP: "JP",
  DE: "EU",
  FR: "EU",
  IT: "EU",
  ES: "EU",
  EZ: "EU",
  EU: "EU",
  EA: "EU",
  AT: "EU",
  BE: "EU",
  NL: "EU",
}

const SPEECH_RE = /发表讲话|发表演讲|主旨演[讲说]|研讨会上/
const POLICY_EVENT_RE = /利率决议|新闻发布会|议息|FOMC|LPR|静默期|OPEC|中期选举|点阵图/
const TOP_SPEAKER_RE = /美联储主席|欧央行行长|欧洲央行行长|日本央行行长|央行行长/

function ensureDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true })
}

function shanghaiParts(ms: number): { date: string; time: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
  const bits = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]))
  return { date: `${bits.year}-${bits.month}-${bits.day}`, time: `${bits.hour}:${bits.minute}` }
}

function readCache(): LiveCache | null {
  try {
    if (!existsSync(CACHE_FILE)) return null
    return JSON.parse(readFileSync(CACHE_FILE, "utf-8")) as LiveCache
  } catch {
    return null
  }
}

function writeCache(cache: LiveCache) {
  ensureDir()
  writeFileSync(CACHE_FILE, JSON.stringify(cache), "utf-8")
}

async function fetchWeek(startSec: number, endSec: number): Promise<WscnRow[]> {
  const url = `${WSCN_URL}?start=${startSec}&end=${endSec}`
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: "https://wallstreetcn.com/calendar",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error(`wscn ${res.status}`)
  const payload = (await res.json()) as { data?: { items?: WscnRow[] } }
  return payload.data?.items ?? []
}

export async function refreshLiveMarketEventCache(opts?: { from?: string; to?: string }): Promise<LiveCache> {
  const today = shanghaiTodayIsoDate()
  const from = (opts?.from || addIsoDays(today, -90)).slice(0, 10)
  const to = (opts?.to || addIsoDays(today, 90)).slice(0, 10)
  const start = Date.parse(`${from}T00:00:00+08:00`)
  const end = Date.parse(`${to}T23:59:59+08:00`)
  const rows: WscnRow[] = []
  const seen = new Set<string>()
  for (let cursor = start; cursor < end; cursor += WEEK_MS) {
    const chunkEnd = Math.min(cursor + WEEK_MS, end + 1)
    const chunk = await fetchWeek(Math.floor(cursor / 1000), Math.floor(chunkEnd / 1000))
    for (const row of chunk) {
      const key = String(row.id ?? `${row.public_date}-${row.title}-${row.event}`)
      if (seen.has(key)) continue
      seen.add(key)
      rows.push(row)
    }
  }
  const cache: LiveCache = {
    fetchedAt: new Date().toISOString(),
    shanghaiDate: today,
    from,
    to,
    rows,
  }
  writeCache(cache)
  return cache
}

async function loadRows(refresh: boolean): Promise<LiveCache> {
  const today = shanghaiTodayIsoDate()
  const cached = readCache()
  if (!refresh && cached?.shanghaiDate === today && cached.rows.length > 0) return cached
  try {
    return await refreshLiveMarketEventCache({
      from: cached?.from || addIsoDays(today, -90),
      to: cached?.to || addIsoDays(today, 90),
    })
  } catch (error) {
    if (cached?.rows.length) return cached
    throw error
  }
}

function countryRegion(id: string, name: string): MarketEventRegion {
  if (REGION_BY_ID[id]) return REGION_BY_ID[id]
  if (name.includes("中国")) return "CN"
  if (name.includes("美国")) return "US"
  if (name.includes("日本")) return "JP"
  if (/欧|德|法|意/.test(name)) return "EU"
  return "GLOBAL"
}

function inferSeries(title: string, region: MarketEventRegion): MarketEventSeries {
  if (/FOMC|联邦基金/.test(title)) return "fomc"
  if (/非农就业/.test(title)) return "nfp"
  if (/LPR|贷款市场报价/.test(title)) return "lpr"
  if (/MLF/.test(title)) return "mlf"
  if (/财新/.test(title) && /PMI/.test(title)) return "pmi-caixin"
  if (/官方/.test(title) && /PMI/.test(title)) return "pmi-nbs"
  if (/欧洲央行/.test(title) && /利率/.test(title)) return "ecb"
  if (/日本央行/.test(title)) return "boj"
  if (/核心?CPI|调和CPI/.test(title)) return "cpi"
  if (/PPI/.test(title)) return "ppi"
  if (/GDP/.test(title)) return region === "CN" ? "cn-gdp" : "us-gdp"
  if (/进出口价格/.test(title)) return "us-import-px"
  return "other"
}

function inferCategory(series: MarketEventSeries, title: string): MarketEventCategory {
  if (series === "fomc" || series === "ecb" || series === "boj" || series === "lpr" || series === "mlf") return "央行"
  if (series === "cpi" || series === "ppi" || /PCE|通胀/.test(title)) return "通胀"
  if (series === "nfp" || /就业|失业/.test(title)) return "就业"
  if (series === "pmi-nbs" || series === "pmi-caixin" || series === "cn-gdp" || series === "us-gdp") return "增长"
  if (/选举|会议|政策/.test(title)) return "政策"
  if (/原油|OPEC|库存/.test(title)) return "商品"
  return "增长"
}

function inferMarkets(series: MarketEventSeries, region: MarketEventRegion): string[] {
  if (series === "fomc" || series === "nfp" || series === "cpi") return ["美债", "美元", "黄金", "美股"]
  if (series === "ecb") return ["欧元", "欧债", "美债"]
  if (series === "boj") return ["日元", "日债", "黄金"]
  if (series === "lpr" || series === "mlf" || series === "pmi-nbs" || series === "cn-gdp") return ["A股", "国债", "人民币"]
  if (region === "CN") return ["A股", "人民币"]
  if (region === "US") return ["美债", "美元"]
  if (region === "EU") return ["欧元", "欧债"]
  if (region === "JP") return ["日元"]
  return ["全球风险资产"]
}

function keepRow(row: WscnRow, title: string, countryId: string, importance: number): boolean {
  const type = String(row.calendar_type || "")
  if (type === "FD") {
    if (importance >= 3) return true
    return importance >= 2 && CORE_COUNTRIES.has(countryId)
  }
  if (SPEECH_RE.test(title) && !(importance >= 4 && TOP_SPEAKER_RE.test(title))) return false
  if (importance >= 3 && POLICY_EVENT_RE.test(title)) return true
  return importance >= 4 && TOP_SPEAKER_RE.test(title)
}

/** WSCN stars are 1–4. 3 is common for M2/社融/吹风会 — treat as 中, reserve 高 for 4. */
function classifyImpact(importance: number, series: MarketEventSeries): MarketEventImpact {
  if (series === "fomc" || series === "nfp" || series === "ecb" || series === "boj") return "high"
  if (importance >= 4) return "high"
  if (importance >= 3) return "medium"
  return "low"
}

function mapRow(row: WscnRow): MarketEvent | null {
  const ts = Number(row.public_date)
  if (!Number.isFinite(ts) || ts <= 0) return null
  const title = String(row.title || row.event || "").trim()
  if (!title) return null
  const countryId = String(row.country_id || "").toUpperCase()
  const importance = Number(row.importance || 0)
  if (!keepRow(row, title, countryId, importance)) return null

  const when = shanghaiParts(ts * (ts < 1e12 ? 1000 : 1))
  const region = countryRegion(countryId, String(row.country || ""))
  const series = inferSeries(title, region)
  const actual = String(row.actual || "").trim()
  const forecast = String(row.forecast || "").trim()
  const previous = String(row.revised || row.previous || "").trim() || String(row.previous || "").trim()
  const prints = [
    actual && `今值 ${actual}`,
    forecast && `预期 ${forecast}`,
    previous && `前值 ${previous}`,
  ].filter(Boolean)
  const impact = classifyImpact(importance, series)
  return {
    id: `wscn-${row.id ?? `${when.date}-${title}`}`,
    date: when.date,
    time: when.time === "00:00" ? "" : when.time,
    region,
    category: inferCategory(series, title),
    series,
    officialDate: when.date,
    title,
    summary: prints.length
      ? `${region === "CN" ? "中国" : region === "US" ? "美国" : String(row.country || "")}宏观数据。${prints.join("，")}。`
      : `${String(row.country || "")}宏观/政策事件，关注是否改变利率与风险偏好定价。`,
    markets: inferMarkets(series, region),
    impact,
    actual: actual || undefined,
    forecast: forecast || undefined,
    previous: previous || undefined,
    outcome: prints.length ? prints.join("；") : undefined,
    source: "华尔街见闻财经日历",
  }
}

export async function getLiveMarketEvents(opts: {
  from: string
  to: string
  refresh?: boolean
}): Promise<{ events: MarketEvent[]; source: string; fetchedAt: string | null; live: boolean }> {
  const from = opts.from.slice(0, 10)
  const to = opts.to.slice(0, 10)
  try {
    const cache = await loadRows(!!opts.refresh)
    const live = cache.rows.map(mapRow).filter((row): row is MarketEvent => !!row)
    const holidays = listMarketEvents({ from, to }).filter((item) => item.category === "休市")
    const seen = new Set<string>()
    const events = [...live, ...holidays]
      .filter((item) => item.date >= from && item.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date) || (a.time || "99:99").localeCompare(b.time || "99:99"))
      .filter((item) => {
        const key = `${item.date}|${item.time}|${item.title}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    return {
      events,
      source: "华尔街见闻财经日历",
      fetchedAt: cache.fetchedAt,
      live: true,
    }
  } catch {
    return {
      events: listMarketEvents({ from, to }),
      source: "本地备用日程",
      fetchedAt: null,
      live: false,
    }
  }
}
