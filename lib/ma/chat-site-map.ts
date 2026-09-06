import type { User } from "@/lib/auth"
import {
  canAccessAiKnowledge,
  canAccessAiResearcher,
  canAccessPfInvestmentPool,
  canAccessPfInvestmentTracking,
  canAccessPfOperations,
  isAdmin,
} from "@/lib/permissions"

export type ChatPageAccess =
  | "any"
  | "mom"
  | "aiKnowledge"
  | "aiResearcher"
  | "pfOperations"
  | "pfInvestment"
  | "pfInvestmentPool"

export type ChatSitePage = {
  id: string
  title: string
  href: string
  trail: string
  access: ChatPageAccess
  aliases: string[]
}

export type ChatNavigateTarget = {
  href: string
  title: string
  trail: string
}

export type ChatNavigateResult =
  | { ok: true; page: ChatSitePage }
  | {
      ok: false
      reason: "denied" | "not_found" | "ambiguous"
      message: string
      candidates?: Array<{ id: string; title: string; trail: string }>
    }

function p(
  id: string,
  title: string,
  href: string,
  trail: string,
  access: ChatPageAccess,
  aliases: string[] = [],
): ChatSitePage {
  return { id, title, href, trail, access, aliases }
}

export const CHAT_SITE_PAGES: ChatSitePage[] = [
  p("home", "总览", "/ma/dashboard", "总览", "any", ["首页", "仪表盘", "市场总览"]),
  p("macro", "宏观市场", "/ma/dashboard/macro-market", "宏观市场", "any", ["宏观", "PCA", "货币信用"]),
  p("stock", "股票市场", "/ma/dashboard/stock-market", "股票市场", "any", ["股票", "A股"]),
  p("futures", "期货市场", "/ma/dashboard/futures-market", "期货市场", "any", ["期货", "南华", "商品期货"]),
  p("options", "期权市场", "/ma/dashboard/options-market", "期权市场", "any", ["期权"]),
  p("realtime", "实时行情", "/ma/dashboard/realtime-quotes", "实时行情", "any", ["CTP", "股指期货行情"]),
  p("all-weather", "全天候跟踪", "/ma/dashboard/all-weather", "全天候跟踪", "any", ["全天候"]),
  p("nhci-index", "南华商品指数", "/ma/dashboard/nhci-index", "南华商品指数", "any", ["NHCI", "南华指数"]),
  p("private-funds", "私募基金", "/ma/dashboard/private-funds", "私募基金", "any", ["私募"]),
  p("tools", "小工具", "/ma/dashboard/tools", "小工具", "any", ["工具集合"]),
  p("settings", "设置", "/ma/dashboard/settings", "设置", "any", ["用户中心", "个人设置"]),

  p("tool-nav-cleaner", "净值表识别及清洗", "/ma/dashboard/tools/nav-cleaner", "小工具 → 净值表识别及清洗", "any", ["NAV清洗", "净值清洗"]),
  p("tool-send-email", "自动发邮件", "/ma/dashboard/tools/send-email", "小工具 → 自动发邮件", "any", ["发邮件"]),
  p("tool-valuation", "估值分析", "/ma/dashboard/tools/valuation", "小工具 → 估值分析", "any", []),
  p("tool-settlement", "结算单分析", "/ma/dashboard/tools/settlement-analysis", "小工具 → 结算单分析", "any", ["结算单"]),
  p("tool-valuation-table", "估值表分析", "/ma/dashboard/tools/valuation-table-analysis", "小工具 → 估值表分析", "any", ["估值表"]),
  p("tool-nav-attribution", "净值归因", "/ma/dashboard/tools/nav-attribution", "小工具 → 净值归因", "any", ["归因"]),

  p("mom", "MOM分析", "/ma/dashboard/mom-analysis", "MOM分析", "mom", ["MOM", "MOM模块"]),
  p("mom-risk-report", "MOM每日风控", "/ma/dashboard/mom-analysis/risk-report", "MOM分析 → MOM每日风控", "mom", ["每日风控", "风控报告"]),
  p("mom-account-risk", "单账户每日风控", "/ma/dashboard/mom-analysis/account-risk-report", "MOM分析 → 单账户每日风控", "mom", ["单账户风控", "CFMMC"]),
  p("mom-trader-analysis", "盘手历史交易复盘", "/ma/dashboard/mom-analysis/trader-analysis", "MOM分析 → 盘手历史交易复盘", "mom", ["盘手分析", "交易复盘", "盘手复盘"]),
  p("mom-pnl-rank", "盈亏排名", "/ma/dashboard/mom-analysis/trader-analysis?tab=pnl-rank", "MOM分析 → 盘手历史交易复盘 → 盈亏排名", "mom", ["盈亏排名"]),
  p("mom-variety-review", "品种交易回顾", "/ma/dashboard/mom-analysis/trader-analysis?tab=variety-review", "MOM分析 → 盘手历史交易复盘 → 品种交易回顾", "mom", ["品种回顾"]),
  p("mom-equity-curve", "盘手收益曲线", "/ma/dashboard/mom-analysis/trader-analysis?tab=equity-curve", "MOM分析 → 盘手历史交易复盘 → 盘手收益曲线", "mom", ["收益曲线", "权益曲线"]),
  p(
    "mom-quant-vs-subjective",
    "量化vs主观",
    "/ma/dashboard/mom-analysis/trader-analysis?tab=quant-vs-subjective",
    "MOM分析 → 盘手历史交易复盘 → 量化vs主观",
    "mom",
    ["主观vs量化", "主观 vs 量化", "量化 vs 主观", "主观量化", "量化主观", "quant vs subjective", "主观和量化"],
  ),
  p("mom-quant-strategy", "量化策略分析", "/ma/dashboard/mom-analysis/trader-analysis?tab=quant-strategy", "MOM分析 → 盘手历史交易复盘 → 量化策略分析", "mom", ["量化策略"]),
  p("mom-carry", "业绩报酬测算", "/ma/dashboard/mom-analysis/carry-calc", "MOM分析 → 业绩报酬测算", "mom", ["提成", "报酬测算"]),
  p("mom-data-import", "数据导入", "/ma/dashboard/mom-analysis/data-import", "MOM分析 → 数据导入", "mom", ["导入核算"]),
  p("mom-anomaly", "异常监测", "/ma/dashboard/mom-analysis/anomaly-detection", "MOM分析 → 异常监测", "mom", ["异常检测"]),

  p("ai-knowledge", "AI知识库", "/ma/dashboard/ai-knowledge", "AI知识库", "aiKnowledge", ["知识库"]),
  p("ai-researcher", "AI研究员", "/ma/dashboard/ai-researcher", "AI研究员", "aiResearcher", ["研究员"]),

  p("pf-funds", "私募基金列表", "/ma/dashboard/private-funds?tab=funds&side=private-funds", "私募基金 → 基金 → 私募基金", "any", ["基金列表"]),
  p("pf-managers-org", "私募管理人", "/ma/dashboard/private-funds?tab=funds&side=fund-managers-org", "私募基金 → 基金 → 私募管理人", "any", ["管理人"]),
  p("pf-managers", "基金经理", "/ma/dashboard/private-funds?tab=funds&side=fund-managers", "私募基金 → 基金 → 基金经理", "any", []),
  p("pf-custom-funds", "自建基金", "/ma/dashboard/private-funds?tab=funds&side=custom-funds", "私募基金 → 基金 → 自建基金", "any", ["自建"]),
  p("pf-custom-index", "自建指数", "/ma/dashboard/private-funds?tab=funds&side=custom-index", "私募基金 → 基金 → 自建指数", "any", []),

  p("pf-market-stock", "私募-股票市场", "/ma/dashboard/private-funds?tab=market&side=stock-market", "私募基金 → 市场 → 股票市场", "any", []),
  p("pf-futures-style", "期货风格因子", "/ma/dashboard/private-funds?tab=market&side=futures-style", "私募基金 → 市场 → 期货风格因子", "any", ["期货因子"]),
  p("pf-equity-style", "股票风格因子", "/ma/dashboard/private-funds?tab=market&side=equity-style", "私募基金 → 市场 → 股票风格因子", "any", ["股票因子"]),
  p("pf-strategy-obs", "策略观察", "/ma/dashboard/private-funds?tab=market&side=strategy-observation", "私募基金 → 市场 → 策略观察", "any", []),
  p("pf-pe-index", "私募指数", "/ma/dashboard/private-funds?tab=market&side=pe-index", "私募基金 → 市场 → 私募指数", "any", []),
  p("pf-pe-industry", "私募行业", "/ma/dashboard/private-funds?tab=market&side=pe-industry", "私募基金 → 市场 → 私募行业", "any", []),

  p("pf-port-new", "新建组合", "/ma/dashboard/private-funds?tab=portfolio&side=port-new", "私募基金 → 组合 → 新建组合", "any", []),
  p("pf-port-sim", "模拟组合", "/ma/dashboard/private-funds?tab=portfolio&side=port-simulated", "私募基金 → 组合 → 模拟组合", "any", []),
  p("pf-port-live", "实盘组合", "/ma/dashboard/private-funds?tab=portfolio&side=port-live", "私募基金 → 组合 → 实盘组合", "any", []),

  p("pf-inv-dd-table", "尽调表格", "/ma/dashboard/private-funds?tab=investment&side=inv-dd-table", "私募基金 → 投资 → 尽调表格", "pfInvestment", ["尽调表"]),
  p("pf-inv-dd-calendar", "尽调日历", "/ma/dashboard/private-funds?tab=investment&side=inv-dd-calendar", "私募基金 → 投资 → 尽调日历", "pfInvestment", []),
  p("pf-inv-dd-report", "尽调报告", "/ma/dashboard/private-funds?tab=investment&side=inv-dd-report", "私募基金 → 投资 → 尽调报告", "pfInvestment", []),
  p("pf-inv-dd-notes", "投资笔记", "/ma/dashboard/private-funds?tab=investment&side=inv-dd-notes", "私募基金 → 投资 → 投资笔记", "pfInvestment", ["笔记"]),
  p("pf-inv-tracking", "跟踪产品", "/ma/dashboard/private-funds?tab=investment&side=inv-tracking", "私募基金 → 投资 → 跟踪产品", "pfInvestment", ["跟踪池"]),
  p("pf-settlement-analysis", "结算单分析", "/ma/dashboard/private-funds", "私募基金 → 跟踪产品 → 结算单分析", "pfInvestment", ["结算单", "监控中心"]),
  p("pf-inv-tracking-mgr", "跟踪管理人", "/ma/dashboard/private-funds?tab=investment&side=inv-tracking-mgr", "私募基金 → 投资 → 跟踪管理人", "pfInvestment", []),
  p("pf-inv-compare", "基金对比", "/ma/dashboard/private-funds?tab=investment&side=inv-compare", "私募基金 → 投资 → 基金对比", "pfInvestment", ["基金对比"]),
  p("pf-inv-overview", "投资概览", "/ma/dashboard/private-funds?tab=investment&side=inv-overview", "私募基金 → 投资 → 投资概览", "pfInvestmentPool", ["投资池"]),
  p("pf-inv-active", "在管产品", "/ma/dashboard/private-funds?tab=investment&side=inv-active", "私募基金 → 投资 → 在管产品", "pfInvestmentPool", []),
  p("pf-inv-fof", "FOF底层", "/ma/dashboard/private-funds?tab=investment&side=inv-fof", "私募基金 → 投资 → FOF底层", "pfInvestmentPool", ["FOF"]),
  p("pf-inv-docs", "资料列表", "/ma/dashboard/private-funds?tab=investment&side=inv-docs", "私募基金 → 投资 → 资料列表", "pfInvestmentPool", []),
  p("pf-inv-direct", "直投产品", "/ma/dashboard/private-funds?tab=investment&side=inv-direct", "私募基金 → 投资 → 直投产品", "pfInvestment", ["直投"]),
  p("pf-inv-direct-port", "直投组合", "/ma/dashboard/private-funds?tab=investment&side=inv-direct-portfolio", "私募基金 → 投资 → 直投组合", "pfInvestment", []),

  p("pf-ops-active", "运维-在管产品", "/ma/dashboard/private-funds?tab=operations&side=ops-active-funds", "私募基金 → 运维 → 在管产品", "pfOperations", []),
  p("pf-ops-fof", "运维-FOF底层", "/ma/dashboard/private-funds?tab=operations&side=ops-fof", "私募基金 → 运维 → FOF底层", "pfOperations", []),
  p("pf-ops-direct", "运维-直投产品", "/ma/dashboard/private-funds?tab=operations&side=ops-direct", "私募基金 → 运维 → 直投产品", "pfOperations", []),
  p("pf-ops-tracking", "运维-跟踪产品", "/ma/dashboard/private-funds?tab=operations&side=ops-tracking", "私募基金 → 运维 → 跟踪产品", "pfOperations", []),
  p("pf-ops-email", "邮箱同步", "/ma/dashboard/private-funds?tab=operations&side=ops-email-sync", "私募基金 → 运维 → 邮箱同步", "pfOperations", ["邮箱"]),
  p("pf-ops-ledger", "台账管理", "/ma/dashboard/private-funds?tab=operations&side=ops-ledger", "私募基金 → 运维 → 台账管理", "pfOperations", ["台账"]),
  p("pf-ops-team", "团队数据", "/ma/dashboard/private-funds?tab=operations&side=ops-team-data", "私募基金 → 运维 → 团队数据", "pfOperations", []),
  p("pf-ops-tags", "策略标签", "/ma/dashboard/private-funds?tab=operations&side=ops-strategy-tags", "私募基金 → 运维 → 策略标签", "pfOperations", ["标签"]),
  p("pf-ops-extract", "要素提取", "/ma/dashboard/private-funds?tab=operations&side=ops-element-extract", "私募基金 → 运维 → 要素提取", "pfOperations", ["要素"]),

  p("pf-cmd-initiate", "发起指令", "/ma/dashboard/private-funds?tab=instructions&side=cmd-initiate", "私募基金 → 指令 → 发起指令", "any", ["指令"]),
  p("pf-cmd-handled", "我处理的指令", "/ma/dashboard/private-funds?tab=instructions&side=cmd-handled", "私募基金 → 指令 → 我处理的", "any", []),
  p("pf-cmd-mine", "我发起的指令", "/ma/dashboard/private-funds?tab=instructions&side=cmd-mine", "私募基金 → 指令 → 我发起的", "any", []),
  p("pf-cmd-all", "所有指令", "/ma/dashboard/private-funds?tab=instructions&side=cmd-all", "私募基金 → 指令 → 所有指令", "any", []),

  p("pf-rpt-mine", "我的报告", "/ma/dashboard/private-funds?tab=reports&side=rpt-mine", "私募基金 → 报告 → 我的报告", "any", ["报告"]),
  p("pf-rpt-templates", "报告模板管理", "/ma/dashboard/private-funds?tab=reports&side=rpt-templates", "私募基金 → 报告 → 模板管理", "any", ["报告模板"]),
]

const PAGE_BY_ID = new Map(CHAT_SITE_PAGES.map((page) => [page.id, page]))

export function isSafeChatHref(href: string): boolean {
  return href.startsWith("/ma/dashboard") && !href.includes("://") && !href.startsWith("//")
}

export function canAccessChatSitePage(user: User | null | undefined, access: ChatPageAccess): boolean {
  if (!user) return access === "any"
  switch (access) {
    case "any":
      return true
    case "mom":
      return isAdmin(user) || user.permissions?.mom === true
    case "aiKnowledge":
      return canAccessAiKnowledge(user)
    case "aiResearcher":
      return canAccessAiResearcher(user)
    case "pfOperations":
      return canAccessPfOperations(user)
    case "pfInvestment":
      return canAccessPfInvestmentTracking(user)
    case "pfInvestmentPool":
      return canAccessPfInvestmentPool(user)
  }
}

export function listAccessibleChatPages(user: User | null | undefined): ChatSitePage[] {
  return CHAT_SITE_PAGES.filter((page) => canAccessChatSitePage(user, page.access))
}

export function formatAccessiblePagesForPrompt(pages: ChatSitePage[]): string {
  const lines = pages.map((page) => `- ${page.id}｜${page.title}｜${page.trail}`)
  return [
    "【系统页面目录】以下仅包含当前账号有权限访问的页面。",
    "用户询问某功能/页面在哪、或要求打开某页面时：必须调用 navigate_to_page（优先传 pageId；不确定则把用户原话放入 query），禁止用 query_database 查找页面位置。",
    "调用成功后前端会自动跳转。用一两句话说明模块路径即可，不要输出完整 URL。",
    "不要提及或尝试打开未出现在本目录中的页面。若目录中没有对应项，告知用户当前账号可能无权限，或系统中没有该页面。",
    ...lines,
  ].join("\n")
}

function normalizeNeedle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s\-_/,，。？?！!：:、()（）【】\[\]]/g, "")
    .replace(/[与和]/g, "vs")
}

function scorePage(page: ChatSitePage, needle: string): number {
  if (!needle) return 0
  const fields = [page.id, page.title, page.trail, ...page.aliases].map(normalizeNeedle)
  let best = 0
  for (const field of fields) {
    if (!field) continue
    if (field === needle) best = Math.max(best, 100 + field.length)
    else if (needle.includes(field)) best = Math.max(best, 80 + field.length)
    else if (field.includes(needle)) best = Math.max(best, 50 + Math.min(field.length, 20))
  }
  if (needle.includes("量化") && needle.includes("主观")) {
    const isQuantSubjective = fields.some((field) => field.includes("量化") && field.includes("主观"))
    if (isQuantSubjective) best = Math.max(best, 90)
  }
  return best
}

export function resolveChatNavigateTarget(
  input: { pageId?: string; query?: string },
  user: User | null | undefined,
): ChatNavigateResult {
  const pageId = input.pageId?.trim() || ""
  const query = input.query?.trim() || ""
  const allowed = listAccessibleChatPages(user)

  if (pageId) {
    const exact = PAGE_BY_ID.get(pageId)
    if (exact) {
      if (!canAccessChatSitePage(user, exact.access) || !isSafeChatHref(exact.href)) {
        return { ok: false, reason: "denied", message: "当前账号没有该页面的访问权限。" }
      }
      return { ok: true, page: exact }
    }
  }

  const needle = normalizeNeedle(pageId || query)
  if (!needle) {
    return { ok: false, reason: "not_found", message: "请提供 pageId 或 query。" }
  }

  const ranked = allowed
    .map((page) => ({ page, score: scorePage(page, needle) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)

  if (ranked.length === 0) {
    return {
      ok: false,
      reason: "not_found",
      message: "未找到匹配页面，或当前账号无权访问该页面。",
    }
  }

  const top = ranked[0]
  const close = ranked.filter((row) => row.score >= top.score - 10)
  if (close.length > 1 && close[0].score < 90) {
    return {
      ok: false,
      reason: "ambiguous",
      message: "匹配到多个页面，请用更具体的名称或 pageId。",
      candidates: close.slice(0, 5).map(({ page }) => ({
        id: page.id,
        title: page.title,
        trail: page.trail,
      })),
    }
  }

  if (!isSafeChatHref(top.page.href)) {
    return { ok: false, reason: "denied", message: "当前账号没有该页面的访问权限。" }
  }
  return { ok: true, page: top.page }
}
