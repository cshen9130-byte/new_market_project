import { getSession } from "@/session"
import type { DueDiligenceSchedule, FofUnderlyingPage, FofUnderlyingProduct, FundDetail, InvestmentNoteDetail, InvestmentNoteListItem, ManagedProduct, ManagedProductsPage, MomUnderlyingRow, Pool, PrivateFundProfile, ReportGenerateResult, ReportNavFrequency, ReportNavRange, ReportProductOption, SearchManager, SearchProduct, TrackingPage, User } from "@/types"

function isAbortLike(error: unknown): boolean {
  if (!error) return false
  if (typeof error === "object" && error !== null) {
    const name = String((error as { name?: unknown }).name || "")
    if (name === "AbortError") return true
  }
  const msg = error instanceof Error ? error.message : String(error)
  return /abort|aborted|cancel+ed|Fetch request has been canceled/i.test(msg)
}

function readableError(raw: string, status: number, context: "login" | "api" = "api"): string {
  const text = raw.replace(/\s+/g, " ").trim()
  if (!text || text.startsWith("<") || text.includes("<!DOCTYPE") || text.includes("<html")) {
    if (status === 401 || status === 403) {
      return context === "login" ? "账号或密码错误" : "没有访问权限，请重新登录后再试"
    }
    if (status >= 500) return "服务器暂时出错，请稍后再试"
    if (status === 404) return "没有找到对应数据，请换一个名称或备案号"
    if (status === 308 || status === 301 || status === 302) {
      return "服务器地址跳转异常，请检查网络后重试"
    }
    return context === "login"
      ? "服务器没有返回登录结果，请检查地址后再试"
      : `服务器返回了异常页面（${status || "?"}），请检查网络后重试`
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

async function request<T>(baseUrl: string, path: string, init: RequestInit = {}, userId?: string, timeoutMs = 25000, context: "login" | "api" = "api"): Promise<T> {
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
      throw new Error(readableError(raw, response.status, context))
    }
    return data as T
  } catch (error) {
    if (isAbortLike(error)) {
      throw new Error("连接超时或请求已取消，请再试一次")
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

export function toPublicUser(raw: {
  id?: string
  name?: string
  email?: string
  role?: string
  permissions?: Record<string, unknown>
}): User {
  const id = String(raw.id || "").trim()
  if (!id) throw new Error("登录响应缺少用户")
  const permissions = normalizePermissions(raw.permissions)
  return {
    id,
    name: String(raw.name || raw.email || "用户"),
    email: String(raw.email || ""),
    role: raw.role,
    permissions,
  }
}

function normalizePermissions(raw: Record<string, unknown> | undefined): User["permissions"] {
  if (!raw || typeof raw !== "object") return undefined
  const out: NonNullable<User["permissions"]> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "boolean") out[key] = value
  }
  return out
}

export async function loginRequest(baseUrl: string, identifier: string, password: string): Promise<User> {
  const data = await request<{ ok?: boolean; user?: { id?: string; name?: string; email?: string; role?: string; permissions?: Record<string, unknown> } }>(
    baseUrl,
    "/api/auth/login",
    { method: "POST", body: JSON.stringify({ identifier, password }) },
    undefined,
    25000,
    "login",
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

export async function fetchManagedProducts(input: { page: number; keyword: string }): Promise<ManagedProductsPage> {
  const params = new URLSearchParams({
    page: String(input.page),
    pageSize: "20",
    sort: "latest_nav_date",
    dir: "desc",
    keyword: input.keyword,
    run_status: "running",
  })
  const data = await authed<Partial<ManagedProductsPage> & { data?: ManagedProduct[] }>(
    `/ma/api/ops/managed-products/list?${params}`,
  )
  return {
    page: data.page ?? input.page,
    pageSize: data.pageSize ?? 20,
    total: data.total ?? 0,
    totalPages: data.totalPages ?? 0,
    data: Array.isArray(data.data) ? data.data : [],
  }
}


export async function fetchFofUnderlying(input: { page: number; keyword: string }): Promise<FofUnderlyingPage> {
  const params = new URLSearchParams({
    page: String(input.page),
    pageSize: "20",
    sort: "latest_nav_date",
    dir: "desc",
    keyword: input.keyword,
    holding_status: "holding",
    fund_class: "private",
  })
  const data = await authed<Partial<FofUnderlyingPage> & { data?: FofUnderlyingProduct[] }>(
    `/ma/api/ops/fof-underlying/list?${params}`,
  )
  return {
    page: data.page ?? input.page,
    pageSize: data.pageSize ?? 20,
    total: data.total ?? 0,
    totalPages: data.totalPages ?? 0,
    data: Array.isArray(data.data) ? data.data : [],
  }
}


export async function fetchMomUnderlying(): Promise<{ total: number; data: MomUnderlyingRow[] }> {
  const data = await authed<{ ok?: boolean; total?: number; data?: MomUnderlyingRow[]; error?: string }>(
    "/ma/api/investment/mom-underlying/list",
  )
  if (data.ok === false) throw new Error(data.error || "加载失败")
  return {
    total: data.total ?? (Array.isArray(data.data) ? data.data.length : 0),
    data: Array.isArray(data.data) ? data.data : [],
  }
}


export async function fetchDueDiligenceSchedules(): Promise<DueDiligenceSchedule[]> {
  const data = await authed<{ ok?: boolean; schedules?: DueDiligenceSchedule[]; error?: string }>(
    "/ma/api/due-diligence-schedules",
  )
  if (data.ok === false) throw new Error(data.error || "加载失败")
  return Array.isArray(data.schedules) ? data.schedules : []
}

export async function fetchInvestmentNotes(scope: "team" | "mine" = "team"): Promise<InvestmentNoteListItem[]> {
  const params = new URLSearchParams({ scope })
  const data = await authed<{ ok?: boolean; notes?: InvestmentNoteListItem[]; error?: string }>(
    `/ma/api/investment-notes?${params}`,
  )
  if (data.ok === false) throw new Error(data.error || "加载失败")
  return Array.isArray(data.notes) ? data.notes : []
}

export async function fetchInvestmentNote(id: string): Promise<InvestmentNoteDetail> {
  const params = new URLSearchParams({ id })
  const data = await authed<{ ok?: boolean; note?: InvestmentNoteDetail; error?: string }>(
    `/ma/api/investment-notes?${params}`,
  )
  if (data.ok === false || !data.note) throw new Error(data.error || "笔记不存在")
  return data.note
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

function normalizeFundCode(raw: string): string {
  let code = String(raw || "").trim()
  if (!code) throw new Error("缺少备案号")
  // Expo Router may leave a once-encoded segment; avoid double-encoding.
  try {
    if (/%[0-9A-Fa-f]{2}/.test(code)) code = decodeURIComponent(code)
  } catch {
    // keep raw
  }
  code = code.trim().replace(/^\/+|\/+$/g, "")
  if (!code) throw new Error("缺少备案号")
  return code
}


export async function fetchPrivateFundProfile(beian_hao: string): Promise<PrivateFundProfile> {
  const beian = normalizeFundCode(beian_hao)
  return authed<PrivateFundProfile>(`/ma/api/private-funds/${encodeURIComponent(beian)}/profile`)
}


export async function fetchFund(code: string): Promise<FundDetail> {
  const beian = normalizeFundCode(code)
  const path = `/ma/api/private-funds/${encodeURIComponent(beian)}`
  const { baseUrl, user } = getSession()
  if (!baseUrl) throw new Error("暂时连不上服务器")
  if (!user?.id) throw new Error("登录已失效，请返回后重新登录")

  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const detail = await request<FundDetail>(baseUrl, path, {}, user.id, 90000, "api")
      const infoCode = String(detail?.info?.beian_hao || "").trim()
      if (!infoCode && !Array.isArray(detail?.nav_series)) {
        throw new Error("产品详情返回为空，请稍后重试")
      }
      return detail
    } catch (error) {
      lastError = error
      const msg = error instanceof Error ? error.message : String(error)
      // Retry once on transient cancel/timeout/network blips (common when leaving AI overlay).
      if (attempt === 0 && /超时|取消|canceled|无法连接|异常页面|跳转异常/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 350))
        continue
      }
      throw error
    }
  }
  throw lastError instanceof Error ? lastError : new Error("加载产品失败")
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

export async function fetchSiteProfile(): Promise<User> {
  const data = await authed<{
    user?: { id?: string; name?: string; email?: string; role?: string; permissions?: Record<string, unknown> }
    error?: string
  }>("/api/auth/me")
  if (!data.user?.id) throw new Error(data.error || "请用电脑版账号登录后再打开简报")
  return toPublicUser(data.user)
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
export type ResearchExportFormat = "docx" | "pdf"

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
      Accept: "application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/msword, application/pdf, application/json",
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
    const mime =
      response.headers.get("Content-Type") ||
      (input.format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    let filename =
      input.format === "pdf"
        ? `${(input.managerName || "管理人").trim() || "管理人"}-管理人画像.pdf`
        : `${(input.managerName || "管理人").trim() || "管理人"}-管理人画像.docx`
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

async function downloadBinary(path: string, timeoutMs = 120000): Promise<{ filename: string; mime: string; bytes: Uint8Array }> {
  const { baseUrl, user } = getSession()
  if (!baseUrl) throw new Error("暂时无法连接服务器")
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers = new Headers({ Accept: "*/*" })
    if (user?.id) headers.set("x-market-user-id", user.id)
    const url = path.startsWith("http") ? path : `${baseUrl}${path}`
    const response = await fetch(url, { headers, signal: controller.signal })
    if (!response.ok) {
      const text = await response.text().catch(() => "")
      let message = readableError(text, response.status)
      try {
        const parsed = JSON.parse(text) as { error?: string }
        if (parsed.error) message = parsed.error
      } catch {
        // keep
      }
      throw new Error(message)
    }
    let filename = "report.bin"
    const disposition = response.headers.get("Content-Disposition") || ""
    const star = disposition.match(/filename\*=UTF-8''([^;]+)/i)
    const plain = disposition.match(/filename="?([^";]+)"?/i)
    if (star?.[1]) {
      try {
        filename = decodeURIComponent(star[1])
      } catch {
        // keep
      }
    } else if (plain?.[1]) {
      filename = plain[1]
    }
    const mime = (response.headers.get("Content-Type") || "application/octet-stream").split(";")[0].trim()
    const buffer = await response.arrayBuffer()
    return { filename, mime, bytes: new Uint8Array(buffer) }
  } catch (error) {
    if (isAbortLike(error)) throw new Error("下载超时，请再试一次")
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export async function searchReportProducts(query: string): Promise<ReportProductOption[]> {
  const q = query.trim()
  if (q.length < 1) return []
  const headers = (() => {
    const { user } = getSession()
    const h: Record<string, string> = { Accept: "application/json" }
    if (user?.id) h["x-market-user-id"] = user.id
    return h
  })()
  const { baseUrl } = getSession()
  if (!baseUrl) throw new Error("暂时无法连接服务器")

  const [managed, priv, custom] = await Promise.all([
    fetch(`${baseUrl}/ma/api/ops/managed-products/list?keyword=${encodeURIComponent(q)}&pageSize=20`, { headers })
      .then((r) => r.json())
      .catch(() => null),
    fetch(`${baseUrl}/ma/api/private-funds/products/search?q=${encodeURIComponent(q)}&format=picker`, { headers })
      .then((r) => r.json())
      .catch(() => null),
    fetch(`${baseUrl}/ma/api/custom-funds/list?scope=team&keyword=${encodeURIComponent(q)}&pageSize=20`, { headers })
      .then((r) => r.json())
      .catch(() => null),
  ])

  const out: ReportProductOption[] = []
  const seen = new Set<string>()
  const push = (product_name: string, beian_hao: string | null, source: ReportProductOption["source"]) => {
    const name = product_name.trim()
    if (!name) return
    const key = `${source}:${beian_hao || ""}:${name}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ product_name: name, beian_hao, source })
  }

  const managedRows = (managed as { data?: { product_name?: string; beian_hao?: string | null }[] } | null)?.data
  if (Array.isArray(managedRows)) {
    for (const row of managedRows) {
      if (row?.product_name) push(row.product_name, row.beian_hao ?? null, "managed")
    }
  }
  if (Array.isArray(priv)) {
    for (const row of priv as Array<string | { product_name?: string; beian_hao?: string | null }>) {
      if (typeof row === "string") push(row, null, "private")
      else if (row?.product_name) push(row.product_name, row.beian_hao ?? null, "private")
    }
  }
  const customRows = (custom as { data?: { product_name?: string; name?: string; beian_hao?: string | null }[] } | null)?.data
  if (Array.isArray(customRows)) {
    for (const row of customRows) {
      const name = row.product_name || row.name
      if (name) push(name, row.beian_hao ?? null, "custom_fund")
    }
  }
  return out.slice(0, 40)
}

export async function fetchReportNavRange(input: {
  kind: "weekly" | "monthly" | "quarterly"
  product_name: string
  beian_hao?: string | null
}): Promise<ReportNavRange> {
  const params = new URLSearchParams({ product_name: input.product_name.trim() })
  if (input.beian_hao) params.set("beian_hao", input.beian_hao)
  const path =
    input.kind === "weekly"
      ? `/ma/api/reports/fof-weekly/nav-range?${params}`
      : input.kind === "monthly"
        ? `/ma/api/reports/fof-monthly/nav-range?${params}`
        : `/ma/api/reports/product-quarterly/nav-range?${params}`
  const data = await authed<{
    error?: string
    nav_start_date?: string | null
    latest_nav_date?: string | null
    beian_hao?: string | null
  }>(path)
  if (data.error) throw new Error(data.error)
  return {
    start: data.nav_start_date ?? null,
    end: data.latest_nav_date ?? null,
    beian_hao: data.beian_hao ?? input.beian_hao ?? null,
  }
}

async function pollFofWeeklyResult(reportId: string): Promise<ReportGenerateResult> {
  const started = Date.now()
  const timeoutMs = 180_000
  let delayMs = 0
  while (Date.now() - started < timeoutMs) {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
    const status = await authed<{
      status?: string
      error?: string
      result?: ReportGenerateResult
    }>(`/ma/api/reports/fof-weekly/status?id=${encodeURIComponent(reportId)}`, undefined, 30000)
    if (status.status === "done" && status.result) return status.result
    if (status.status === "error") throw new Error(status.error || "生成周报失败")
    delayMs = delayMs === 0 ? 400 : Math.min(1500, delayMs + 200)
  }
  throw new Error("周报生成超时，请稍后再试")
}

export async function generateFofWeeklyReport(input: {
  product_name: string
  beian_hao?: string | null
  week_begin: string
  week_end: string
  report_title?: string
  benchmark_key?: string
  nav_frequency?: ReportNavFrequency
}): Promise<ReportGenerateResult> {
  const json = await authed<{
    async?: boolean
    reportId?: string
    error?: string
  } & Partial<ReportGenerateResult>>(
    "/ma/api/reports/fof-weekly/generate",
    {
      method: "POST",
      body: JSON.stringify({
        product_name: input.product_name.trim(),
        beian_hao: input.beian_hao || undefined,
        week_begin: input.week_begin,
        week_end: input.week_end,
        report_title: input.report_title?.trim() || input.product_name.trim(),
        benchmark_key: input.benchmark_key || "IF",
        nav_frequency: input.nav_frequency || "weekly",
      }),
    },
    60000,
  )
  if (json.async && typeof json.reportId === "string") {
    return pollFofWeeklyResult(json.reportId)
  }
  if (!json.download?.png || !json.download?.pdf) {
    throw new Error(json.error || "生成周报失败")
  }
  return json as ReportGenerateResult
}

export async function generateFofMonthlyReport(input: {
  product_name: string
  beian_hao?: string | null
  month_begin: string
  month_end: string
  report_title?: string
  benchmark_key?: string
  nav_frequency?: ReportNavFrequency
  report_layout?: "curve" | "review"
}): Promise<ReportGenerateResult> {
  const json = await authed<ReportGenerateResult & { error?: string }>(
    "/ma/api/reports/fof-monthly/generate",
    {
      method: "POST",
      body: JSON.stringify({
        product_name: input.product_name.trim(),
        beian_hao: input.beian_hao || undefined,
        month_begin: input.month_begin,
        month_end: input.month_end,
        report_title: input.report_title?.trim() || input.product_name.trim(),
        benchmark_key: input.benchmark_key || "IF",
        nav_frequency: input.nav_frequency || "weekly",
        report_layout: input.report_layout || "review",
      }),
    },
    180000,
  )
  if (!json.download?.png || !json.download?.pdf) {
    throw new Error(json.error || "生成月报失败")
  }
  return json
}

export async function generateProductQuarterlyReport(input: {
  product_name: string
  beian_hao?: string | null
  period_begin: string
  period_end: string
  report_title?: string
  bench1_key?: string
  bench2_key?: string
  nav_frequency?: ReportNavFrequency
  commentary?: string
  brand_name?: string
  investment_manager?: string
}): Promise<ReportGenerateResult> {
  const json = await authed<ReportGenerateResult & { error?: string }>(
    "/ma/api/reports/product-quarterly/generate",
    {
      method: "POST",
      body: JSON.stringify({
        product_name: input.product_name.trim(),
        beian_hao: input.beian_hao || undefined,
        period_begin: input.period_begin,
        period_end: input.period_end,
        report_title: input.report_title?.trim() || input.product_name.trim(),
        bench1_key: input.bench1_key || "000001.SH",
        bench2_key: input.bench2_key || "IF",
        nav_frequency: input.nav_frequency || "weekly",
        commentary: input.commentary || undefined,
        brand_name: input.brand_name || undefined,
        investment_manager: input.investment_manager || undefined,
      }),
    },
    180000,
  )
  if (!json.download?.png || !json.download?.pdf) {
    throw new Error(json.error || "生成季报失败")
  }
  return json
}

export async function downloadReportArtifact(downloadPath: string): Promise<{ filename: string; mime: string; bytes: Uint8Array }> {
  return downloadBinary(downloadPath, 120000)
}
