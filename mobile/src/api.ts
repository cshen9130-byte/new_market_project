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

type MomDay = { date: string; pnl: number }

type MomNavPoint = {
  date: string
  nav: number
  cumCapital: number
  dailyReturn: number
  pnl: number
}

export type MomRow = { name: string; pnl: number }

export type MomOverview = {
  date: string | null
  pnl: number | null
  nav: number | null
  dailyReturn: number | null
  ytdReturn: number | null
  cumCapital: number | null
  subAccountCount: number | null
  emptyAccountCount: number | null
  curve: { date: string; value: number }[]
  days: MomDay[]
  sectors: MomRow[]
  products: MomRow[]
  accounts: MomRow[]
  sectorDate: string | null
  accountDate: string | null
}

function latestActiveDate(groups: MomDay[][], minActive: number): string | null {
  const counts = new Map<string, number>()
  for (const rows of groups) {
    for (const row of rows) {
      if (row.pnl !== 0) counts.set(row.date, (counts.get(row.date) ?? 0) + 1)
    }
  }
  let best: string | null = null
  for (const [date, count] of counts) {
    if (count < minActive) continue
    if (best == null || date > best) best = date
  }
  return best
}

function pnlOn(rows: MomDay[], date: string | null): number {
  if (rows.length === 0) return 0
  if (!date) return rows[rows.length - 1]?.pnl ?? 0
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rows[i].date <= date) return rows[i].pnl
  }
  return 0
}

function ranked(entries: Array<[string, MomDay[]]>, date: string | null): MomRow[] {
  return entries
    .map(([name, rows]) => ({ name, pnl: pnlOn(rows, date) }))
    .filter((row) => row.pnl !== 0)
    .sort((a, b) => b.pnl - a.pnl)
}

function downsampleCurve(rows: { date: string; value: number }[], max: number) {
  if (rows.length <= max) return rows
  const step = (rows.length - 1) / (max - 1)
  const out: { date: string; value: number }[] = []
  for (let i = 0; i < max; i += 1) out.push(rows[Math.round(i * step)])
  return out
}

export async function fetchSiteProfile(): Promise<{
  id: string
  name: string
  email: string
  role?: string
  permissions?: Record<string, unknown>
}> {
  const data = await authed<{
    user?: { id?: string; name?: string; email?: string; role?: string; permissions?: Record<string, unknown> }
    error?: string
  }>("/api/auth/me")
  const id = String(data.user?.id || "").trim()
  if (!id) throw new Error(data.error || "请用电脑版账号登录后再打开简报")
  return {
    id,
    name: String(data.user?.name || ""),
    email: String(data.user?.email || ""),
    role: data.user?.role,
    permissions: data.user?.permissions,
  }
}

export type MomSource = "mom" | "account"

const MOM_ENDPOINTS: Record<MomSource, { nav: string; category: string; accounts: string; minActive: number }> = {
  mom: {
    nav: "/ma/api/mom-analysis/product-nav",
    category: "/ma/api/mom-analysis/category-pnl",
    accounts: "/ma/api/mom-analysis/account-daily-pnl",
    minActive: 2,
  },
  account: {
    nav: "/ma/api/account-risk/product-nav",
    category: "/ma/api/account-risk/category-pnl",
    accounts: "/ma/api/account-risk/account-daily-pnl",
    minActive: 1,
  },
}

export async function fetchMomOverview(source: MomSource = "mom"): Promise<MomOverview> {
  const timeout = 60000
  const endpoints = MOM_ENDPOINTS[source]
  const [navResult, categoryResult, accountResult] = await Promise.all([
    authed<{ ok?: boolean; data?: MomNavPoint[]; error?: string; notYetRun?: boolean }>(
      endpoints.nav,
      undefined,
      timeout,
    ),
    authed<{ sectorData?: Record<string, MomDay[]>; productData?: Record<string, MomDay[]>; error?: string }>(
      endpoints.category,
      undefined,
      timeout,
    ),
    authed<{
      ok?: boolean
      accountData?: Record<string, MomDay[]>
      subAccountCount?: number
      emptyAccountCount?: number
      error?: string
      notYetRun?: boolean
    }>(endpoints.accounts, undefined, timeout),
  ])

  if (navResult.ok === false) throw new Error(navResult.error || "组合盈亏加载失败")
  if (categoryResult.error) throw new Error(categoryResult.error)
  if (accountResult.ok === false) throw new Error(accountResult.error || "账户盈亏加载失败")

  const series = Array.isArray(navResult.data) ? navResult.data : []
  const latest = series.length > 0 ? series[series.length - 1] : null
  const yearStart = `${new Date().getFullYear()}-01-01`
  const firstOfYear = series.find((row) => row.date >= yearStart) ?? series[0]
  const ytdReturn = latest && firstOfYear && firstOfYear.nav > 0 ? latest.nav / firstOfYear.nav - 1 : null
  const sectorGroups = Object.values(categoryResult.sectorData ?? {})
  const productGroups = Object.entries(categoryResult.productData ?? {})
  const accountGroups = Object.entries(accountResult.accountData ?? {})
  const sectorDate = latestActiveDate(sectorGroups, endpoints.minActive)
  const accountDate = latestActiveDate(accountGroups.map(([, rows]) => rows), endpoints.minActive)
  const curve = downsampleCurve(
    series.map((row) => ({ date: row.date.slice(0, 10), value: (row.nav - 1) * 100 })),
    160,
  )

  return {
    date: latest?.date?.slice(0, 10) ?? null,
    pnl: latest?.pnl ?? null,
    nav: latest?.nav ?? null,
    dailyReturn: latest?.dailyReturn ?? null,
    ytdReturn,
    cumCapital: latest?.cumCapital ?? null,
    subAccountCount: accountResult.subAccountCount ?? null,
    emptyAccountCount: accountResult.emptyAccountCount ?? null,
    curve,
    days: series.slice(-12).reverse().map((row) => ({ date: row.date.slice(0, 10), pnl: row.pnl })),
    sectors: ranked(Object.entries(categoryResult.sectorData ?? {}), sectorDate),
    products: ranked(productGroups, sectorDate),
    accounts: ranked(accountGroups, accountDate),
    sectorDate,
    accountDate,
  }
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

export type AssistantChatMessage = { role: "user" | "assistant"; content: string }

export type AssistantChatNavigate = {
  href: string
  title?: string
  trail?: string
}

export type AssistantChatHandlers = {
  onDelta?: (delta: string) => void
  onNavigate?: (nav: AssistantChatNavigate) => void
}

/** Stream the web MA assistant (POST /ma/api/chat). Parses OpenAI-style SSE + navigate events. */
export function streamAssistantChat(
  body: {
    messages: AssistantChatMessage[]
    pageContext?: string
  },
  handlers: AssistantChatHandlers,
  signal: AbortSignal,
): Promise<void> {
  const { baseUrl, user } = getSession()
  if (!baseUrl) return Promise.reject(new Error("\u6682\u65f6\u8fde\u4e0d\u4e0a\u670d\u52a1\u5668"))
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", `${baseUrl}/ma/api/chat`)
    xhr.setRequestHeader("Accept", "text/event-stream, application/json")
    xhr.setRequestHeader("Content-Type", "application/json")
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
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>
            navigate?: AssistantChatNavigate
            error?: string
          }
          if (parsed.navigate?.href) handlers.onNavigate?.(parsed.navigate)
          const delta = parsed.choices?.[0]?.delta?.content
          if (delta) handlers.onDelta?.(delta)
          if (typeof parsed.error === "string" && parsed.error) {
            reject(new Error(parsed.error))
          }
        } catch {
          // ignore partial JSON
        }
      }
    }
    const fail = (status: number) => {
      let message = status ? `\u8bf7\u6c42\u5931\u8d25\uff08${status}\uff09` : "\u65e0\u6cd5\u8fde\u63a5\u670d\u52a1\u5668\uff0c\u8bf7\u786e\u8ba4\u5730\u5740\u548c\u7f51\u7edc"
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
    xhr.ontimeout = () => reject(new Error("\u8fde\u63a5\u8d85\u65f6\uff0c\u8bf7\u518d\u8bd5\u4e00\u6b21"))
    xhr.onabort = () => {
      const error = new Error("Aborted")
      error.name = "AbortError"
      reject(error)
    }
    signal.addEventListener("abort", () => xhr.abort(), { once: true })
    xhr.send(JSON.stringify(body))
  })
}
﻿
export type ResearchExportFormat = "doc" | "pdf"

export async function exportResearchReport(input: {
  markdown: string
  title?: string
  subjectLine?: string
  managerName?: string
  format: ResearchExportFormat
}): Promise<{ filename: string; mime: string; bytes: Uint8Array }> {
  const { baseUrl, user } = getSession()
  if (!baseUrl) throw new Error("暂时连不上服务器")
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120000)
  try {
    const headers = new Headers({
      Accept: "application/msword, application/pdf, application/json",
      "Content-Type": "application/json",
    })
    if (user?.id) headers.set("x-market-user-id", user.id)
    const response = await fetch(`${baseUrl}/ma/api/ai-researcher/export-report`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
      signal: controller.signal,
    })
    if (!response.ok) {
      let message = `导出失败（${response.status}）`
      try {
        const parsed = (await response.json()) as { error?: string }
        if (parsed.error) message = parsed.error
      } catch {
        // ignore
      }
      throw new Error(message)
    }
    const mime = response.headers.get("Content-Type") || (input.format === "pdf" ? "application/pdf" : "application/msword")
    let filename =
      input.format === "pdf"
        ? `${(input.managerName || "管理人").trim() || "管理人"}-管理人画像.pdf`
        : `${(input.managerName || "管理人").trim() || "管理人"}-管理人画像.doc`
    const disposition = response.headers.get("Content-Disposition") || ""
    const star = disposition.match(/filename\*=UTF-8''([^;]+)/i)
    const plain = disposition.match(/filename="?([^";]+)"?/i)
    if (star?.[1]) {
      try {
        filename = decodeURIComponent(star[1])
      } catch {
        // keep default
      }
    } else if (plain?.[1]) {
      filename = plain[1]
    }
    const buffer = await response.arrayBuffer()
    return { filename, mime: mime.split(";")[0].trim(), bytes: new Uint8Array(buffer) }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("导出超时，请再试一次")
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}


