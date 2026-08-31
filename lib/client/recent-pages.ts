export type RecentPageHit = {
  href: string
  title: string
  visitCount: number
  lastVisitedAt: number
}

const STORAGE_PREFIX = "ma_recent_pages:"
const MAX_STORED = 80
const REVISIT_WINDOW_MS = 60_000
const FRECENCY_HALF_LIFE_DAYS = 14
const USER_ID_RE = /^[A-Za-z0-9._:-]{1,80}$/

const PATH_META: Record<string, { title: string; description: string }> = {
  "/ma/dashboard/macro-market": { title: "宏观市场", description: "经济指标、利率与全球市场" },
  "/ma/dashboard/stock-market": { title: "股票市场", description: "指数与行业分析" },
  "/ma/dashboard/futures-market": { title: "期货市场", description: "大宗商品与合约" },
  "/ma/dashboard/options-market": { title: "期权市场", description: "期权链与波动率" },
  "/ma/dashboard/realtime-quotes": { title: "实时行情", description: "股指期货实时 K 线" },
  "/ma/dashboard/private-funds": { title: "私募基金", description: "净值与绩效跟踪" },
  "/ma/dashboard/private-funds/search": { title: "基金搜索", description: "私募基金 · 全局搜索" },
  "/ma/dashboard/private-funds/portfolio/create": { title: "新建组合", description: "私募基金 · 组合" },
  "/ma/dashboard/private-funds/due-diligence-report/new": { title: "新建尽调报告", description: "私募基金 · 尽调" },
  "/ma/dashboard/mom-analysis": { title: "MOM分析", description: "月度绩效与归因" },
  "/ma/dashboard/mom-analysis/risk-report": { title: "MOM 每日风控", description: "MOM分析" },
  "/ma/dashboard/mom-analysis/account-risk-report": { title: "单账户每日风控", description: "MOM分析" },
  "/ma/dashboard/mom-analysis/trader-analysis": { title: "盘手历史交易复盘", description: "MOM分析" },
  "/ma/dashboard/mom-analysis/carry-calc": { title: "业绩报酬测算", description: "MOM分析" },
  "/ma/dashboard/mom-analysis/data-import": { title: "数据导入", description: "MOM分析" },
  "/ma/dashboard/mom-analysis/anomaly-detection": { title: "异常检测", description: "MOM分析" },
  "/ma/dashboard/tools": { title: "小工具", description: "数据处理辅助工具" },
  "/ma/dashboard/tools/nav-cleaner": { title: "净值表识别及清洗", description: "小工具" },
  "/ma/dashboard/tools/send-email": { title: "自动发邮件", description: "小工具" },
  "/ma/dashboard/tools/valuation": { title: "估值分析", description: "小工具" },
  "/ma/dashboard/tools/settlement-analysis": { title: "结算单分析", description: "小工具" },
  "/ma/dashboard/tools/valuation-table-analysis": { title: "估值表分析", description: "小工具" },
  "/ma/dashboard/tools/nav-attribution": { title: "净值归因", description: "小工具" },
  "/ma/dashboard/ai-knowledge": { title: "AI知识库", description: "知识检索与智能问答" },
  "/ma/dashboard/ai-researcher": { title: "AI研究员", description: "自动规划并生成研究报告" },
  "/ma/dashboard/all-weather": { title: "全天候跟踪", description: "全市场跟踪看板" },
  "/ma/dashboard/nhci-index": { title: "南华商品指数", description: "指数行情" },
  "/ma/dashboard/settings": { title: "设置", description: "个人与计算配置" },
}

const PF_TAB_LABELS: Record<string, string> = {
  market: "市场",
  funds: "基金",
  portfolio: "组合",
  investment: "投资",
  operations: "运维",
  instructions: "指令",
  reports: "报告",
}

const PF_SIDE_LABELS: Record<string, string> = {
  "stock-market": "股票市场",
  "futures-style": "期货风格因子",
  "equity-style": "股票风格因子",
  "strategy-observation": "策略观察",
  "pe-index": "私募指数",
  "pe-industry": "私募行业",
  "private-funds": "私募基金",
  "fund-managers-org": "私募管理人",
  "fund-managers": "基金经理",
  "custom-funds": "自建基金",
  "custom-index": "自建指数",
  "port-new": "新建组合",
  "port-simulated": "模拟组合",
  "port-live": "实盘组合",
  "inv-dd-table": "尽调表格",
  "inv-dd-calendar": "尽调日历",
  "inv-dd-report": "尽调报告",
  "inv-dd-notes": "投资笔记",
  "inv-tracking": "跟踪产品",
  "inv-tracking-mgr": "跟踪管理人",
  "inv-compare": "基金对比",
  "inv-overview": "投资概览",
  "inv-active": "在管产品",
  "inv-fof": "FOF底层",
  "inv-docs": "资料列表",
  "inv-direct": "直投产品",
  "inv-direct-portfolio": "直投组合",
  "ops-active-funds": "在管产品",
  "ops-fof": "FOF底层",
  "ops-direct": "直投产品",
  "ops-tracking": "跟踪产品",
  "ops-email-sync": "邮箱同步",
  "ops-ledger": "台账管理",
  "ops-team-data": "团队数据",
  "ops-strategy-tags": "策略标签",
  "ops-element-extract": "要素提取",
  "cmd-initiate": "发起指令",
  "cmd-handled": "我处理的",
  "cmd-mine": "我发起的",
  "cmd-all": "所有指令",
  "rpt-mine": "我的报告",
  "rpt-templates": "模板管理",
}

const PF_RESERVED = new Set([
  "custom",
  "search",
  "managers",
  "fund-compare",
  "portfolio",
  "due-diligence-report",
])

const GENERIC_TITLES = new Set([
  "基金详情",
  "估值表分析",
  "估值表记录",
  "自建基金",
  "自建基金净值",
  "管理人详情",
  "基金对比",
  "组合详情",
  "私募基金",
])

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`
}

export function isTrackableUserId(userId: string | null | undefined): boolean {
  return !!userId && USER_ID_RE.test(userId.trim())
}

export function normalizePageHref(pathname: string, search = ""): string {
  const path = (pathname.split("?")[0] || "/").replace(/\/+$/, "") || "/"
  if (path.length > 240) return path.slice(0, 240)
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
  const kept = new URLSearchParams()
  if (path === "/ma/dashboard/private-funds") {
    const tab = (params.get("tab") || "").trim()
    const side = (params.get("side") || "").trim()
    if (tab) kept.set("tab", tab.slice(0, 40))
    if (side) kept.set("side", side.slice(0, 40))
  } else if (path === "/ma/dashboard/settings") {
    const tab = (params.get("tab") || "").trim()
    if (tab) kept.set("tab", tab.slice(0, 40))
  }
  const qs = kept.toString()
  return qs ? `${path}?${qs}` : path
}

export function shouldTrackHref(href: string): boolean {
  const path = href.split("?")[0]
  if (!path.startsWith("/ma/dashboard")) return false
  if (path === "/ma/dashboard") return false
  if (path.startsWith("/ma/dashboard/admin")) return false
  return true
}

export function describePage(href: string): { title: string; description: string } {
  const [path, qs = ""] = href.split("?")
  const params = new URLSearchParams(qs)
  if (path === "/ma/dashboard/private-funds") {
    const tab = params.get("tab") || ""
    const side = params.get("side") || ""
    const sideLabel = side ? PF_SIDE_LABELS[side] : ""
    const tabLabel = tab ? PF_TAB_LABELS[tab] : ""
    if (sideLabel) {
      return {
        title: sideLabel,
        description: ["私募基金", tabLabel].filter(Boolean).join(" · "),
      }
    }
    if (tabLabel) {
      return { title: tabLabel, description: "私募基金" }
    }
  }
  if (path === "/ma/dashboard/settings") {
    const tab = params.get("tab") || ""
    if (tab === "metric-templates") {
      return { title: "指标模板", description: "设置" }
    }
  }
  const exact = PATH_META[path]
  if (exact) return exact

  const segs = path.split("/").filter(Boolean)
  // /ma/dashboard/private-funds/:id/...
  if (segs[0] === "ma" && segs[1] === "dashboard" && segs[2] === "private-funds" && segs[3] && !PF_RESERVED.has(segs[3])) {
    const beian = decodeURIComponent(segs[3])
    if (segs[4] === "valuation" && segs[5] === "records") {
      return { title: "估值表记录", description: `私募基金 · ${beian}` }
    }
    if (segs[4] === "valuation") {
      return { title: "估值表分析", description: `私募基金 · ${beian}` }
    }
    return { title: "基金详情", description: `私募基金 · ${beian}` }
  }
  if (path.startsWith("/ma/dashboard/private-funds/custom/")) {
    const code = decodeURIComponent(segs[4] || "")
    if (segs[5] === "nav") return { title: "自建基金净值", description: code ? `自建基金 · ${code}` : "自建基金" }
    return { title: "自建基金", description: code ? `自建基金 · ${code}` : "私募基金" }
  }
  if (path.startsWith("/ma/dashboard/private-funds/managers/")) {
    const no = decodeURIComponent(segs[4] || "")
    return { title: "管理人详情", description: no ? `私募管理人 · ${no}` : "私募管理人" }
  }
  if (path.startsWith("/ma/dashboard/private-funds/fund-compare/")) {
    return { title: "基金对比", description: "私募基金 · 投资" }
  }
  if (path.startsWith("/ma/dashboard/private-funds/portfolio/")) {
    return { title: "组合详情", description: "私募基金 · 组合" }
  }
  const last = segs[segs.length - 1] || "页面"
  return { title: decodeURIComponent(last), description: "最近访问" }
}

function isBetterTitle(next: string, current: string, href: string): boolean {
  const trimmed = next.trim()
  if (!trimmed || trimmed.length > 80) return false
  if (trimmed === current) return false
  const catalog = describePage(href).title
  if (GENERIC_TITLES.has(trimmed) && !GENERIC_TITLES.has(current) && current) return false
  if (GENERIC_TITLES.has(current) && !GENERIC_TITLES.has(trimmed)) return true
  if (!current || current === catalog) return trimmed !== catalog
  return trimmed.length > current.length
}

function parseHits(raw: unknown): RecentPageHit[] {
  if (!Array.isArray(raw)) return []
  const out: RecentPageHit[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const href = typeof (item as RecentPageHit).href === "string" ? (item as RecentPageHit).href.trim() : ""
    const title = typeof (item as RecentPageHit).title === "string" ? (item as RecentPageHit).title.trim() : ""
    const visitCount = (item as RecentPageHit).visitCount
    const lastVisitedAt = (item as RecentPageHit).lastVisitedAt
    if (!href.startsWith("/ma/dashboard")) continue
    if (typeof visitCount !== "number" || !Number.isFinite(visitCount) || visitCount < 1) continue
    if (typeof lastVisitedAt !== "number" || !Number.isFinite(lastVisitedAt)) continue
    out.push({
      href: href.slice(0, 280),
      title: (title || describePage(href).title).slice(0, 80),
      visitCount: Math.min(Math.round(visitCount), 100_000),
      lastVisitedAt,
    })
  }
  return out
}

export function readLocalRecentPages(userId: string): RecentPageHit[] {
  if (typeof window === "undefined" || !isTrackableUserId(userId)) return []
  try {
    const raw = localStorage.getItem(storageKey(userId))
    if (!raw) return []
    return parseHits(JSON.parse(raw))
  } catch {
    return []
  }
}

export function writeLocalRecentPages(userId: string, pages: RecentPageHit[]): void {
  if (typeof window === "undefined" || !isTrackableUserId(userId)) return
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(pages.slice(0, MAX_STORED)))
  } catch {
    // quota / private mode
  }
}

export function mergeRecentPages(a: RecentPageHit[], b: RecentPageHit[]): RecentPageHit[] {
  const map = new Map<string, RecentPageHit>()
  for (const hit of [...a, ...b]) {
    const prev = map.get(hit.href)
    if (!prev) {
      map.set(hit.href, { ...hit })
      continue
    }
    const title = isBetterTitle(hit.title, prev.title, hit.href) ? hit.title : prev.title
    map.set(hit.href, {
      href: hit.href,
      title,
      visitCount: Math.max(prev.visitCount, hit.visitCount),
      lastVisitedAt: Math.max(prev.lastVisitedAt, hit.lastVisitedAt),
    })
  }
  return [...map.values()]
    .sort((x, y) => y.lastVisitedAt - x.lastVisitedAt)
    .slice(0, MAX_STORED)
}

export function recordPageVisit(userId: string, href: string, titleHint?: string): RecentPageHit[] {
  const normalized = normalizePageHref(href.split("?")[0], href.includes("?") ? href.slice(href.indexOf("?")) : "")
  if (!shouldTrackHref(normalized) || !isTrackableUserId(userId)) {
    return readLocalRecentPages(userId)
  }
  const now = Date.now()
  const pages = readLocalRecentPages(userId)
  const catalogTitle = describePage(normalized).title
  const hint = (titleHint || "").trim().slice(0, 80)
  const idx = pages.findIndex((p) => p.href === normalized)
  if (idx >= 0) {
    const prev = pages[idx]
    const title = hint && isBetterTitle(hint, prev.title, normalized) ? hint : prev.title
    const withinWindow = now - prev.lastVisitedAt < REVISIT_WINDOW_MS
    pages[idx] = {
      ...prev,
      title,
      visitCount: withinWindow ? prev.visitCount : prev.visitCount + 1,
      lastVisitedAt: now,
    }
  } else {
    pages.unshift({
      href: normalized,
      title: hint && !GENERIC_TITLES.has(hint) ? hint : catalogTitle,
      visitCount: 1,
      lastVisitedAt: now,
    })
  }
  const next = pages
    .sort((x, y) => y.lastVisitedAt - x.lastVisitedAt)
    .slice(0, MAX_STORED)
  writeLocalRecentPages(userId, next)
  return next
}

export function frecencyScore(hit: RecentPageHit, now = Date.now()): number {
  const ageDays = Math.max(0, (now - hit.lastVisitedAt) / 86_400_000)
  return hit.visitCount * Math.exp(-ageDays / FRECENCY_HALF_LIFE_DAYS)
}

export function rankFrequentPages(pages: RecentPageHit[], limit = 8, now = Date.now()): RecentPageHit[] {
  return [...pages]
    .sort((a, b) => {
      const diff = frecencyScore(b, now) - frecencyScore(a, now)
      if (diff !== 0) return diff
      return b.lastVisitedAt - a.lastVisitedAt
    })
    .slice(0, limit)
}

export function formatVisitMeta(hit: RecentPageHit, now = Date.now()): string {
  const age = Math.max(0, now - hit.lastVisitedAt)
  let when = "刚刚"
  if (age >= 86_400_000) when = `${Math.floor(age / 86_400_000)} 天前`
  else if (age >= 3_600_000) when = `${Math.floor(age / 3_600_000)} 小时前`
  else if (age >= 60_000) when = `${Math.floor(age / 60_000)} 分钟前`
  return `访问 ${hit.visitCount} 次 · ${when}`
}

export function parseRecentPagesPayload(raw: unknown): RecentPageHit[] {
  return parseHits(raw)
}

/** Only keep in-page headings for dynamic routes (fund names, etc.). */
export function shouldApplyHeadingHint(href: string, heading: string): boolean {
  const trimmed = heading.trim()
  if (!trimmed || trimmed.length > 80) return false
  const catalog = describePage(href).title
  return GENERIC_TITLES.has(catalog) && trimmed !== catalog
}
