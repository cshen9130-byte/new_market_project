import { getSession } from "@/session"
import type { FundDetail, Pool, SearchManager, SearchProduct, TrackingPage, User } from "@/types"

function readableError(raw: string, status: number): string {
  const text = raw.replace(/\s+/g, " ").trim()
  if (!text || text.startsWith("<") || text.includes("<!DOCTYPE") || text.includes("<html")) {
    if (status === 401 || status === 403) return "账号或密码错误"
    if (status >= 500) return "服务器暂时出错，请再登录一次"
    return "服务器没有返回登录结果，请检查地址后再试"
  }
  return text.length > 80 ? `${text.slice(0, 80)}…` : text
}

const FALLBACK_POOLS: Pool[] = [
  { pool_key: "all", label: "全部" },
  { pool_key: "bfl", label: "bfl跟踪池" },
  { pool_key: "bfl_ops", label: "bfl运维池" },
  { pool_key: "jy", label: "JY跟踪池" },
  { pool_key: "jy_ops", label: "JY运维池" },
]

async function request<T>(baseUrl: string, path: string, init: RequestInit = {}, userId?: string, timeoutMs = 25000): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers = new Headers(init.headers)
    headers.set("Accept", "application/json")
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json")
    if (userId) headers.set("x-market-user-id", userId)
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers, signal: controller.signal })
    const text = await response.text()
    let data: unknown = {}
    if (text) {
      try {
        data = JSON.parse(text) as unknown
      } catch {
        data = { error: text.slice(0, 180) }
      }
    }
    if (!response.ok) {
      const record = data && typeof data === "object" ? (data as { error?: unknown; detail?: unknown }) : {}
      const raw = typeof record.error === "string" ? record.error : typeof record.detail === "string" ? record.detail : ""
      throw new Error(readableError(raw, response.status))
    }
    return data as T
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("连接超时，请检查手机网络")
    }
    if (error instanceof TypeError) {
      throw new Error("无法连接服务器，请确认地址、端口和同一网络")
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function authed<T>(path: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
  const { baseUrl, user } = getSession()
  if (!baseUrl) throw new Error("暂时连不上服务器")
  return request<T>(baseUrl, path, init, user?.id, timeoutMs)
}

export function toPublicUser(raw: { id?: string; name?: string; email?: string; role?: string }): User {
  const id = String(raw.id || "").trim()
  if (!id) throw new Error("登录返回缺少用户")
  return {
    id,
    name: String(raw.name || raw.email || "用户"),
    email: String(raw.email || ""),
    role: raw.role,
  }
}

export async function loginRequest(baseUrl: string, identifier: string, password: string): Promise<User> {
  const data = await request<{ ok?: boolean; user?: { id?: string; name?: string; email?: string; role?: string } }>(
    baseUrl,
    "/api/auth/login",
    { method: "POST", body: JSON.stringify({ identifier, password }) },
  )
  if (!data.user) throw new Error("登录失败")
  return toPublicUser(data.user)
}

export async function fetchPools(): Promise<Pool[]> {
  try {
    const data = await authed<{ data?: Pool[] | { team?: Pool[] } }>("/ma/api/tracking-funds/pools?scope=team")
    const rows = Array.isArray(data.data) ? data.data : data.data?.team
    const team = (rows || []).filter((row) => row.pool_key && row.label)
    return [{ pool_key: "all", label: "全部" }, ...team]
  } catch {
    return FALLBACK_POOLS
  }
}

export async function fetchTracking(input: { pool: string; page: number; keyword: string }): Promise<TrackingPage> {
  const params = new URLSearchParams({
    pool: input.pool,
    page: String(input.page),
    pageSize: "20",
    sort: "latest_nav_date",
    dir: "desc",
    keyword: input.keyword,
  })
  const data = await authed<Partial<TrackingPage>>(`/ma/api/tracking-funds/list?${params}`)
  return {
    page: data.page ?? input.page,
    pageSize: data.pageSize ?? 20,
    total: data.total ?? 0,
    totalPages: data.totalPages ?? 0,
    data: Array.isArray(data.data) ? data.data : [],
  }
}

export async function searchFunds(query: string): Promise<{ products: SearchProduct[]; managers: SearchManager[] }> {
  const params = new URLSearchParams({ q: query, limit: "20" })
  const data = await authed<{ products?: SearchProduct[]; managers?: SearchManager[] }>(
    `/ma/api/private-funds/global-search?${params}`,
  )
  return {
    products: Array.isArray(data.products) ? data.products : [],
    managers: Array.isArray(data.managers) ? data.managers : [],
  }
}

export async function fetchFund(code: string): Promise<FundDetail> {
  return authed<FundDetail>(`/ma/api/private-funds/${encodeURIComponent(code)}`)
}

export type ResearchFundHit = {
  beian_hao: string
  product_name: string
  manager: string
  strategy_l1: string | null
  strategy_l2: string | null
  strategy_l3: string | null
}

export async function searchResearchFunds(query: string): Promise<ResearchFundHit[]> {
  const params = new URLSearchParams({ q: query })
  const data = await authed<ResearchFundHit[]>(`/ma/api/ai-researcher/fund-search?${params}`)
  return Array.isArray(data) ? data : []
}

export function streamPost(
  url: string,
  body: unknown,
  onEvent: (event: Record<string, unknown>) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", url)
    xhr.setRequestHeader("Accept", "text/event-stream, application/json")
    xhr.setRequestHeader("Content-Type", "application/json")
    const { user } = getSession()
    if (user?.id) xhr.setRequestHeader("x-market-user-id", user.id)
    xhr.timeout = 0
    let buffer = ""
    let offset = 0
    const pump = () => {
      const next = xhr.responseText.slice(offset)
      offset = xhr.responseText.length
      if (!next) return
      buffer += next
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith("data:")) continue
        const payload = trimmed.slice(5).trim()
        if (!payload || payload === "[DONE]") continue
        try {
          onEvent(JSON.parse(payload) as Record<string, unknown>)
        } catch {
          // ignore a partial event
        }
      }
    }
    const fail = (status: number) => {
      let message = status ? `请求失败（${status}）` : "无法连接服务器，请确认地址和网络"
      try {
        const parsed = JSON.parse(xhr.responseText) as { error?: unknown }
        if (typeof parsed.error === "string" && parsed.error && !parsed.error.startsWith("<")) message = parsed.error
      } catch {
        // body was not JSON
      }
      reject(new Error(message))
    }
    xhr.onprogress = pump
    xhr.onload = () => {
      pump()
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else fail(xhr.status)
    }
    xhr.onerror = () => fail(0)
    xhr.ontimeout = () => reject(new Error("连接超时，请再运行一次"))
    xhr.onabort = () => {
      const error = new Error("Aborted")
      error.name = "AbortError"
      reject(error)
    }
    signal.addEventListener("abort", () => xhr.abort(), { once: true })
    xhr.send(JSON.stringify(body))
  })
}

export function streamResearch(
  path: string,
  body: unknown,
  onEvent: (event: Record<string, unknown>) => void,
  signal: AbortSignal,
): Promise<void> {
  const { baseUrl } = getSession()
  if (!baseUrl) return Promise.reject(new Error("暂时连不上服务器"))
  return streamPost(`${baseUrl}/ma/api/ai-researcher/${path}`, body, onEvent, signal)
}

export type KbFolder = {
  name: string
  relativePath: string
  folders: KbFolder[]
  documents: KbDocument[]
}

export type KbDocument = {
  name: string
  relativePath: string
  extension: string
  canChat: boolean
}

export async function fetchKnowledgeTree(): Promise<KbFolder> {
  const data = await authed<{ ok?: boolean; tree?: KbFolder; error?: string }>("/api/knowledge-base/tree")
  if (!data.tree) throw new Error(data.error || "知识库是空的")
  return data.tree
}

export async function fetchKnowledgeText(relativePath: string): Promise<string> {
  const { baseUrl, user } = getSession()
  if (!baseUrl) throw new Error("暂时连不上服务器")
  const params = new URLSearchParams({ path: relativePath, text: "1" })
  const headers = new Headers({ Accept: "text/plain, application/json" })
  if (user?.id) headers.set("x-market-user-id", user.id)
  const response = await fetch(`${baseUrl}/api/knowledge-base/file?${params}`, { headers })
  const text = await response.text()
  if (!response.ok) {
    let message = "打不开这份资料"
    try {
      const parsed = JSON.parse(text) as { error?: unknown }
      if (typeof parsed.error === "string" && parsed.error) message = parsed.error
    } catch {
      // body was not JSON
    }
    throw new Error(message)
  }
  return text
}

export type AwVariantId = "vol9-20m" | "vol5-10m"
export type AwSleeveKey = "Equity" | "Bonds" | "Gold" | "Commodity"

export type AwPosition = {
  asset: string
  label: string
  contract?: string
  sleeve: AwSleeveKey
  lots: number
  price: number
  multiplier: number
  margin: number
  targetWeight: number
  targetRiskShare?: number
  riskShare: number
  dailyPnl: number
  cumPnl: number
}

export type AwSleeve = {
  sleeve: AwSleeveKey
  label: string
  lots: number
  notional: number
  margin: number
  riskShare: number
  dailyPnl: number
  cumPnl: number
  products: AwPosition[]
}

export type AwOverview = {
  variant?: { id: string; label: string; hint: string; volTarget: number; initialCapital: number }
  strategy: {
    name: string
    volTarget: number
    volMandate: number
    backtestStart: string
    backtestEnd: string
    lastRebalance: string
    summary: {
      cagr: number
      annVol: number
      sharpe: number
      maxDrawdown: number
      cumulativeReturn: number
      nRebalances: number
    }
    sleeveBacktest: Array<{ sleeve: string; label: string; cagr: string; vol: string; sharpe: string; maxDd: string }>
    lastBudget: Record<string, number>
  }
  settings?: { contractTenor?: string }
  book: {
    startedAt: string
    asOf: string
    initialCapital: number
    equity: number
    dailyPnl: number
    cumPnl: number
    daily: Array<{ date: string; equity: number; dailyPnl: number; sleevePnl?: Record<string, number> }>
  }
  isRebalanceDay?: boolean
  rebalanceTrades?: Array<{
    asset: string
    label: string
    contract: string
    prevContract?: string
    prevLots: number
    newLots: number
    delta: number
    side: string
    price: number
  }>
  sleeves: AwSleeve[]
  totals: { lots: number; margin: number; marginUtil: number }
}

export async function fetchAllWeather(variant: AwVariantId, refresh = false): Promise<AwOverview> {
  const params = new URLSearchParams({ variant })
  if (refresh) params.set("refresh", "1")
  const data = await authed<AwOverview & { ok?: boolean; error?: string }>(
    `/api/all-weather?${params}`,
    undefined,
    60000,
  )
  if (!data.book || !data.sleeves) throw new Error(data.error || "全天候暂无数据")
  return data
}

export type QuoteCandle = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type QuoteTick = {
  symbol: string
  last: number | null
  bid: number | null
  ask: number | null
  volume: number | null
  open_interest: number | null
  pre_close: number | null
  pre_settlement: number | null
  update_time: string | null
}

export type QuoteProduct = {
  product: string
  name: string
  symbol: string
  candles: QuoteCandle[]
  quote: QuoteTick
}

export async function fetchIndexQuotes(): Promise<QuoteProduct[]> {
  const data = await authed<{ ok?: boolean; products?: QuoteProduct[]; error?: string }>(
    "/ma/api/realtime-quotes/cffex",
    undefined,
    30000,
  )
  if (!data.products?.length) throw new Error(data.error || "暂时没有行情")
  return data.products
}

export type KlineInterval = "1m" | "5m" | "15m" | "30m" | "1h" | "1d"

export async function fetchKline(symbol: string, interval: KlineInterval): Promise<{ candles: QuoteCandle[]; quote: QuoteTick | null }> {
  const params = new URLSearchParams({ symbol, interval })
  const data = await authed<{ ok?: boolean; candles?: QuoteCandle[]; quote?: QuoteTick | null; error?: string }>(
    `/ma/api/realtime-quotes/kline?${params}`,
    undefined,
    30000,
  )
  if (!data.candles) throw new Error(data.error || "K线加载失败")
  return { candles: data.candles, quote: data.quote ?? null }
}

export function streamKnowledge(
  body: unknown,
  onEvent: (event: Record<string, unknown>) => void,
  signal: AbortSignal,
): Promise<void> {
  const { baseUrl } = getSession()
  if (!baseUrl) return Promise.reject(new Error("暂时连不上服务器"))
  return streamPost(`${baseUrl}/api/knowledge-base/chat`, body, onEvent, signal)
}
