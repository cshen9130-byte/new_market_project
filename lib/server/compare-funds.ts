import { fundNameCore, normalizeRegisterCode } from "@/lib/server/fund-picker-search"
import {
  beianFamilyKey,
  buildTieredBeianCode,
  shareClassFromProductName,
  stripShareClassSuffix,
  type ShareClassLetter,
} from "@/lib/server/share-class-product"

const WINDOW_DAYS: Array<{ field: string; days: number }> = [
  { field: "ret_1w", days: 7 },
  { field: "ret_1m", days: 31 },
  { field: "ret_3m", days: 92 },
  { field: "ret_6m", days: 183 },
  { field: "ret_1y", days: 365 },
  { field: "sharpe_1y", days: 365 },
  { field: "calmar_1y", days: 365 },
]

export type CompareMetrics = {
  ret_1w: number | null
  ret_1m: number | null
  ret_3m: number | null
  ret_6m: number | null
  ret_1y: number | null
  sharpe_1y: number | null
  calmar_1y: number | null
}

export type CompareFund = {
  register_number: string
  fund_name: string
  manager: string
  strategy: string
  strategy_l1: string | null
  strategy_l2: string | null
  strategy_l3: string | null
  inception_date: string | null
  latest_nav: number | null
  latest_nav_date: string | null
  share_class: ShareClassLetter | null
  nav_scope: "self" | "parent"
  metrics: CompareMetrics
  incomplete_windows: string[]
}

export type CompareBinding = {
  query: string
  register_number: string
  fund_name: string
  match: "exact_code" | "share_parent" | "name"
  match_score: number
  share_class: ShareClassLetter | null
  nav_loaded: boolean
  nav_scope: "self" | "parent"
}

export type CompareNote = {
  register_number: string
  path: string
  page: number | null
  quote: string
}

export function compactFundCore(name: string): string {
  return fundNameCore(stripShareClassSuffix(name)).replace(/[\s\u3000]+/g, "").toLowerCase()
}

function numberTokens(core: string): string[] {
  return core.match(/\d+/g) ?? []
}

/** True when the stored product is this query, not a shorter sibling such as 聚宝4号. */
export function nameBindsToQuery(
  query: string,
  productName: string,
  shortName?: string | null,
): boolean {
  const q = compactFundCore(query)
  if (q.length < 2) return false
  const qNums = numberTokens(q)
  const names = [productName, shortName ?? ""].map(compactFundCore).filter((n) => n.length >= 2)
  return names.some((n) => {
    if (!qNums.every((num) => numberTokens(n).includes(num))) return false
    if (n === q || n.includes(q)) return true
    return q.includes(n) && n.length >= 4
  })
}

export function nameMatchScore(
  query: string,
  productName: string,
  shortName?: string | null,
): number | null {
  if (!nameBindsToQuery(query, productName, shortName)) return null
  const q = compactFundCore(query)
  const names = [productName, shortName ?? ""].map(compactFundCore)
  return names.some((n) => n === q) ? 1 : 0.85
}

/**
 * Parent codes whose tiered share-class code is exactly `code`.
 * SB595C is the C share of SSB595. It is not a prefix of SB5957.
 */
export function shareClassParentCandidates(
  code: string,
): { letter: ShareClassLetter; parents: string[] } | null {
  const normalized = normalizeRegisterCode(code)
  if (!normalized) return null
  const letter = normalized.match(/([ABC])$/u)?.[1] as ShareClassLetter | undefined
  if (!letter) return null
  const stripped = normalized.slice(0, -1)
  const candidates = [stripped, `S${stripped}`, stripped.startsWith("S") ? stripped.slice(1) : ""]
  const parents: string[] = []
  const seen = new Set<string>()
  for (const parent of candidates) {
    if (!parent || seen.has(parent)) continue
    seen.add(parent)
    if (buildTieredBeianCode(parent, letter) === normalized) parents.push(parent)
  }
  parents.sort((a, b) => Number(b.startsWith("S")) - Number(a.startsWith("S")) || b.length - a.length)
  return parents.length ? { letter, parents } : null
}

export function parseCompareSubject(raw: string): {
  query: string
  shareClass: ShareClassLetter | null
  registerCode: string | null
  baseName: string
} {
  const query = raw.trim()
  const registerCode = normalizeRegisterCode(query)
  if (registerCode) {
    return {
      query,
      shareClass: shareClassParentCandidates(registerCode)?.letter ?? null,
      registerCode,
      baseName: query,
    }
  }
  const shareClass = shareClassFromProductName(query)
  return {
    query,
    shareClass,
    registerCode: null,
    baseName: shareClass ? stripShareClassSuffix(query) : query,
  }
}

export function fundAgeDays(inception: string, asOf: string): number | null {
  const start = Date.parse(`${inception.slice(0, 10)}T00:00:00Z`)
  const end = Date.parse(`${asOf.slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  return Math.round((end - start) / 86_400_000)
}

/** Windows the fund has not been alive long enough to fill. Empty strategy fields are not windows. */
export function incompleteWindows(inception: string | null, asOf: string | null): string[] {
  if (!inception || !asOf) return []
  const age = fundAgeDays(inception, asOf)
  if (age == null) return []
  return WINDOW_DAYS.filter((window) => age < window.days).map((window) => window.field)
}

export function teamStrategyKey(
  l1?: string | null,
  l2?: string | null,
  l3?: string | null,
): string {
  return [l1, l2, l3].map((value) => String(value ?? "").trim()).filter(Boolean).join(" / ")
}

export function teamStrategyLabel(
  l1?: string | null,
  l2?: string | null,
  l3?: string | null,
): string {
  return teamStrategyKey(l1, l2, l3) || "未填写"
}

export function groupByTeamStrategy(
  funds: Array<{ register_number: string; strategy_l1: string | null; strategy_l2: string | null; strategy_l3: string | null }>,
): {
  same_strategy: boolean
  groups: Array<{ strategy: string; register_numbers: string[] }>
} {
  const grouped = new Map<string, string[]>()
  for (const fund of funds) {
    const strategy = teamStrategyLabel(fund.strategy_l1, fund.strategy_l2, fund.strategy_l3)
    const list = grouped.get(strategy) ?? []
    list.push(fund.register_number)
    grouped.set(strategy, list)
  }
  const keys = funds.map((fund) => teamStrategyKey(fund.strategy_l1, fund.strategy_l2, fund.strategy_l3))
  const sameStrategy = funds.length >= 2 && keys.every((key) => key.length > 0 && key === keys[0])
  return {
    same_strategy: sameStrategy,
    groups: [...grouped.entries()].map(([strategy, register_numbers]) => ({ strategy, register_numbers })),
  }
}

export function distinctFundFamilies(registerNumbers: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const code of registerNumbers) {
    const key = beianFamilyKey(code) ?? code.trim().toUpperCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

export function passageNamesFund(text: string, names: string[], registerNumber: string): boolean {
  const compact = text.replace(/[\s\u3000]+/g, "")
  const code = registerNumber.trim()
  if (code && compact.toUpperCase().includes(code.toUpperCase())) return true
  const lower = compact.toLowerCase()
  return names.some((name) => {
    const core = compactFundCore(name)
    return core.length >= 4 && lower.includes(core)
  })
}

export function navScopeFor(
  queryShareClass: ShareClassLetter | null,
  productName: string,
): "self" | "parent" {
  if (!queryShareClass) return "self"
  return shareClassFromProductName(productName) === queryShareClass ? "self" : "parent"
}

function cell(value: number | null, field: string, incomplete: string[]): string {
  if (value == null) return "—"
  const text = String(value)
  return incomplete.includes(field) ? `${text} 未满` : text
}

function shareLines(bindings: CompareBinding[], funds: CompareFund[]): string[] {
  const lines: string[] = []
  const byCode = new Map(funds.map((fund) => [fund.register_number, fund]))
  for (const binding of bindings) {
    if (!binding.share_class || binding.nav_scope !== "parent") continue
    const fund = byCode.get(binding.register_number)
    const name = fund?.fund_name || binding.fund_name
    lines.push(
      `查询「${binding.query}」绑定 ${name}（${binding.register_number}）的${binding.share_class}类份额。公布净值挂在该备案号上，不是单独的${binding.share_class}类净值序列。`,
    )
  }
  return lines
}

/** Database table plus a short verdict. Numbers are copied from `funds`, not written by a model. */
export function buildCompareReport(input: {
  same_strategy: boolean
  groups: Array<{ strategy: string; register_numbers: string[] }>
  bindings: CompareBinding[]
  funds: CompareFund[]
  notes: CompareNote[]
}): string {
  const verdict = input.same_strategy
    ? "这几只基金的团队策略相同。业绩只取数据库原值，不另作配置建议。"
    : input.groups.length === 1 && input.groups[0]?.strategy === "未填写"
      ? "团队策略栏为空，不能视为同一策略，未做排序，也不给出配置建议。"
      : "这几只基金不是同一团队策略，未做同策略排序，也不给出配置建议。"

  const lines = [
    "# 基金对比",
    "",
    verdict,
    "",
    "业绩数字以 `funds` 为准，单位与 fund/view 相同：收益是百分数（13.76 表示 13.76%），夏普和卡玛是比率。下表由这些字段原样抄出。标成「未满」的区间短于基金成立至今，数值与成立以来涨跌相同，不能当作完整区间业绩。",
    "",
    "| 策略 | 备案号 |",
    "| --- | --- |",
    ...input.groups.map((group) => `| ${group.strategy} | ${group.register_numbers.join("、")} |`),
    "",
  ]

  const shares = shareLines(input.bindings, input.funds)
  if (shares.length) {
    lines.push(...shares, "")
  }

  lines.push(
    "| 基金 | 备案号 | 管理人 | 成立 | 最新净值 | 净值日期 | 近1周 | 近1月 | 近3月 | 近6月 | 近1年 | 近1年夏普 | 近1年卡玛 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  )
  for (const fund of input.funds) {
    const incomplete = fund.incomplete_windows
    const metrics = fund.metrics
    lines.push(
      `| ${fund.fund_name} | ${fund.register_number} | ${fund.manager || "—"} | ${fund.inception_date || "—"} | ${fund.latest_nav ?? "—"} | ${fund.latest_nav_date || "—"} | ${cell(metrics.ret_1w, "ret_1w", incomplete)} | ${cell(metrics.ret_1m, "ret_1m", incomplete)} | ${cell(metrics.ret_3m, "ret_3m", incomplete)} | ${cell(metrics.ret_6m, "ret_6m", incomplete)} | ${cell(metrics.ret_1y, "ret_1y", incomplete)} | ${cell(metrics.sharpe_1y, "sharpe_1y", incomplete)} | ${cell(metrics.calmar_1y, "calmar_1y", incomplete)} |`,
    )
  }

  if (input.notes.length) {
    lines.push("", "## 投资笔记", "")
    for (const note of input.notes) {
      const page = note.page != null ? `，第 ${note.page} 页` : ""
      lines.push(`- ${note.register_number}（${note.path}${page}）：${note.quote}`)
    }
  }

  return lines.join("\n")
}

export function missReport(misses: Array<{ query: string; reason: string }>): string {
  const lines = ["未生成对比报告。以下对象没有绑定到数据库记录：", ""]
  for (const miss of misses) lines.push(`- ${miss.query}：${miss.reason}`)
  lines.push("", "未绑定的对象不会用其他基金或投资笔记补全业绩、策略或管理人。")
  return lines.join("\n")
}
