import { randomUUID } from "crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"
import { getServerStoragePath } from "@/lib/server/storage"

export type CustomFundScope = "team" | "mine"

export type CustomFundRecord = {
  id: string
  scope: CustomFundScope
  owner_user_id: string | null
  product_name: string
  product_code: string
  serial_no: string
  benchmark_index: string
  tags: string[]
  platform_strategy_l1: string | null
  platform_strategy_l2: string | null
  platform_strategy_l3: string | null
  team_strategy_l1: string | null
  team_strategy_l2: string | null
  team_strategy_l3: string | null
  created_by: string
  created_at: string
}

export type CustomFundListRow = {
  id: string
  serial_no: string | null
  product_name: string
  product_code: string | null
  personal_tags: string[] | null
  strategy_l1: string | null
  strategy_l2: string | null
  latest_nav: string | null
  latest_nav_date: string | null
  cumulative_nav: string | null
  latest_price_change: string | null
  ret_1w: string | null
  ret_1y: string | null
  ret_ann_since_inception: string | null
  ret_ytd: string | null
  ret_1m: string | null
  ret_3m: string | null
  ret_6m: string | null
  sharpe_1y: string | null
  calmar_1y: string | null
  benchmark_index: string | null
  metric_calc_time: string | null
  nav_completeness: string | null
  inception_date: string | null
  fund_type: string | null
  nav_frequency: string | null
  team_member: string | null
  remark: string | null
  created_by: string | null
  created_at: string | null
}

export type CustomFundListParams = {
  page: number
  pageSize: number
  scope: CustomFundScope
  ownerUserId?: string
  strategySource: "company" | "platform"
  strategyL1: string
  strategyL2: string
  teamMember: string
  personalTags: string[]
  keyword: string
  sort: string
  dir: "asc" | "desc"
}

export type CreateCustomFundInput = {
  scope: CustomFundScope
  ownerUserId?: string
  product_name: string
  benchmark_index: string
  tags?: string[]
  platform_strategy_l1?: string
  platform_strategy_l2?: string
  platform_strategy_l3?: string
  team_strategy_l1?: string
  team_strategy_l2?: string
  team_strategy_l3?: string
  created_by?: string
}

export type UpdateCustomFundInput = {
  product_code: string
  ownerUserId?: string
  product_name: string
  benchmark_index: string
  tags?: string[]
  platform_strategy_l1?: string
  platform_strategy_l2?: string
  platform_strategy_l3?: string
  team_strategy_l1?: string
  team_strategy_l2?: string
  team_strategy_l3?: string
}

function storageDir(): string {
  return getServerStoragePath("custom_funds")
}

function fundsFile(): string {
  return path.join(storageDir(), "funds.json")
}

function readFunds(): CustomFundRecord[] {
  mkdirSync(storageDir(), { recursive: true })
  const file = fundsFile()
  if (!existsSync(file)) return []
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8"))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeFunds(funds: CustomFundRecord[]): void {
  mkdirSync(storageDir(), { recursive: true })
  writeFileSync(fundsFile(), JSON.stringify(funds, null, 2))
}

function nextProductCode(funds: CustomFundRecord[]): string {
  let max = 380000
  for (const fund of funds) {
    const n = parseInt(fund.product_code, 10)
    if (!Number.isNaN(n) && n > max) max = n
  }
  return String(max + 1)
}

function strategyFields(
  fund: CustomFundRecord,
  strategySource: "company" | "platform",
): { strategy_l1: string | null; strategy_l2: string | null } {
  if (strategySource === "company") {
    return {
      strategy_l1: fund.team_strategy_l1,
      strategy_l2: fund.team_strategy_l2,
    }
  }
  return {
    strategy_l1: fund.platform_strategy_l1,
    strategy_l2: fund.platform_strategy_l2,
  }
}

function toListRow(
  fund: CustomFundRecord,
  strategySource: "company" | "platform",
): CustomFundListRow {
  const { strategy_l1, strategy_l2 } = strategyFields(fund, strategySource)
  const latestNav = navHelpers().getCustomFundLatestNav(fund.product_code)
  return {
    id: fund.id,
    serial_no: fund.serial_no,
    product_name: fund.product_name,
    product_code: fund.product_code,
    personal_tags: fund.scope === "mine" ? fund.tags : null,
    strategy_l1,
    strategy_l2,
    latest_nav: latestNav?.latest_nav ?? null,
    latest_nav_date: latestNav?.latest_nav_date ?? null,
    cumulative_nav: latestNav?.cumulative_nav ?? null,
    latest_price_change: latestNav?.latest_price_change ?? null,
    ret_1w: null,
    ret_1y: null,
    ret_ann_since_inception: null,
    ret_ytd: null,
    ret_1m: null,
    ret_3m: null,
    ret_6m: null,
    sharpe_1y: null,
    calmar_1y: null,
    benchmark_index: fund.benchmark_index,
    metric_calc_time: null,
    nav_completeness: null,
    inception_date: null,
    fund_type: null,
    nav_frequency: null,
    team_member: fund.created_by || null,
    remark: null,
    created_by: fund.created_by || null,
    created_at: fund.created_at.slice(0, 19).replace("T", " "),
  }
}

function sortValue(row: CustomFundListRow, sort: string): string | number {
  const v = row[sort as keyof CustomFundListRow]
  if (v == null) return ""
  if (Array.isArray(v)) return v.join(",")
  return v
}

export function createCustomFund(input: CreateCustomFundInput): CustomFundRecord {
  const funds = readFunds()
  const product_code = nextProductCode(funds)
  const now = new Date().toISOString()
  const fund: CustomFundRecord = {
    id: randomUUID(),
    scope: input.scope,
    owner_user_id: input.scope === "mine" ? (input.ownerUserId || null) : null,
    product_name: input.product_name.trim(),
    product_code,
    serial_no: product_code,
    benchmark_index: input.benchmark_index,
    tags: input.tags ?? [],
    platform_strategy_l1: input.platform_strategy_l1?.trim() || null,
    platform_strategy_l2: input.platform_strategy_l2?.trim() || null,
    platform_strategy_l3: input.platform_strategy_l3?.trim() || null,
    team_strategy_l1: input.team_strategy_l1?.trim() || null,
    team_strategy_l2: input.team_strategy_l2?.trim() || null,
    team_strategy_l3: input.team_strategy_l3?.trim() || null,
    created_by: input.created_by?.trim() || "",
    created_at: now,
  }
  funds.push(fund)
  writeFunds(funds)
  return fund
}

export function updateCustomFund(input: UpdateCustomFundInput): CustomFundRecord | null {
  const funds = readFunds()
  const code = input.product_code.trim()
  const idx = funds.findIndex((fund) => fund.product_code === code)
  if (idx === -1) return null

  const fund = funds[idx]
  if (fund.scope === "mine" && input.ownerUserId && fund.owner_user_id !== input.ownerUserId) {
    return null
  }

  funds[idx] = {
    ...fund,
    product_name: input.product_name.trim(),
    benchmark_index: input.benchmark_index,
    tags: input.tags ?? [],
    platform_strategy_l1: input.platform_strategy_l1?.trim() || null,
    platform_strategy_l2: input.platform_strategy_l2?.trim() || null,
    platform_strategy_l3: input.platform_strategy_l3?.trim() || null,
    team_strategy_l1: input.team_strategy_l1?.trim() || null,
    team_strategy_l2: input.team_strategy_l2?.trim() || null,
    team_strategy_l3: input.team_strategy_l3?.trim() || null,
  }
  writeFunds(funds)
  return funds[idx]
}

export function deleteCustomFund(productCode: string, ownerUserId?: string): boolean {
  const code = productCode.trim()
  if (!code) return false
  const funds = readFunds()
  const idx = funds.findIndex((fund) => fund.product_code === code)
  if (idx === -1) return false

  const fund = funds[idx]
  if (fund.scope === "mine" && ownerUserId && fund.owner_user_id !== ownerUserId) {
    return false
  }

  funds.splice(idx, 1)
  writeFunds(funds)
  navHelpers().clearCustomFundNav(code)
  return true
}

export function listCustomFunds(params: CustomFundListParams): {
  data: CustomFundListRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
} {
  const {
    page,
    pageSize,
    scope,
    ownerUserId,
    strategySource,
    strategyL1,
    strategyL2,
    teamMember,
    personalTags,
    keyword,
    sort,
    dir,
  } = params

  let rows = readFunds()
    .filter((fund) => fund.scope === scope)
    .filter((fund) => scope !== "mine" || !ownerUserId || fund.owner_user_id === ownerUserId)
    .map((fund) => toListRow(fund, strategySource))

  if (strategyL1) {
    rows = rows.filter((row) => row.strategy_l1 === strategyL1)
  }
  if (strategyL2) {
    rows = rows.filter((row) => row.strategy_l2 === strategyL2)
  }
  if (teamMember) {
    rows = rows.filter((row) => row.team_member === teamMember)
  }
  if (personalTags.length > 0) {
    rows = rows.filter((row) => {
      const tags = row.personal_tags ?? []
      return personalTags.every((tag) => tags.includes(tag))
    })
  }
  if (keyword.trim()) {
    const kw = keyword.trim().toLowerCase()
    rows = rows.filter((row) =>
      row.product_name.toLowerCase().includes(kw)
      || (row.product_code ?? "").toLowerCase().includes(kw),
    )
  }

  rows.sort((a, b) => {
    const av = sortValue(a, sort)
    const bv = sortValue(b, sort)
    const cmp = String(av).localeCompare(String(bv), "zh")
    return dir === "asc" ? cmp : -cmp
  })

  const total = rows.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const start = (safePage - 1) * pageSize
  const data = rows.slice(start, start + pageSize)

  return { data, total, page: safePage, pageSize, totalPages }
}

export function listCustomFundTeamMembers(): string[] {
  const members = new Set<string>()
  for (const fund of readFunds()) {
    if (fund.scope === "team" && fund.created_by.trim()) {
      members.add(fund.created_by.trim())
    }
  }
  return Array.from(members).sort((a, b) => a.localeCompare(b, "zh"))
}

export function getCustomFundByCode(productCode: string): CustomFundRecord | null {
  const code = productCode.trim()
  if (!code) return null
  return readFunds().find((fund) => fund.product_code === code) ?? null
}

export function findCustomFundByName(productName: string): CustomFundRecord | null {
  const name = productName.trim()
  if (!name) return null
  const funds = readFunds()
  return (
    funds.find((fund) => fund.product_name === name)
    ?? funds.find((fund) => fund.product_name.includes(name) || name.includes(fund.product_name))
    ?? null
  )
}

function canAccessFund(fund: CustomFundRecord, ownerUserId?: string): boolean {
  if (fund.scope === "mine" && ownerUserId && fund.owner_user_id !== ownerUserId) {
    return false
  }
  return true
}

export function assertCustomFundAccess(productCode: string, ownerUserId?: string): CustomFundRecord | null {
  const fund = getCustomFundByCode(productCode)
  if (!fund || !canAccessFund(fund, ownerUserId)) return null
  return fund
}

function navHelpers() {
  // Lazy load avoids circular import with custom-fund-nav.ts
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@/lib/server/custom-fund-nav") as typeof import("@/lib/server/custom-fund-nav")
}

export type CustomFundDetail = {
  id: string
  product_name: string
  product_code: string
  benchmark_index: string
  scope: CustomFundScope
  tags: string[]
  platform_strategy_l1: string | null
  platform_strategy_l2: string | null
  platform_strategy_l3: string | null
  team_strategy_l1: string | null
  team_strategy_l2: string | null
  team_strategy_l3: string | null
  created_by: string
  created_at: string
  nav_series: Array<{
    price_date: string
    nav: string
    cumulative_nav: string
    cum_nav_withdrawal: string
    price_change: string
  }>
}

export function getCustomFundDetail(productCode: string, ownerUserId?: string): CustomFundDetail | null {
  const fund = getCustomFundByCode(productCode)
  if (!fund) return null
  if (fund.scope === "mine" && ownerUserId && fund.owner_user_id !== ownerUserId) {
    return null
  }
  return {
    id: fund.id,
    product_name: fund.product_name,
    product_code: fund.product_code,
    benchmark_index: fund.benchmark_index,
    scope: fund.scope,
    tags: fund.tags,
    platform_strategy_l1: fund.platform_strategy_l1,
    platform_strategy_l2: fund.platform_strategy_l2,
    platform_strategy_l3: fund.platform_strategy_l3,
    team_strategy_l1: fund.team_strategy_l1,
    team_strategy_l2: fund.team_strategy_l2,
    team_strategy_l3: fund.team_strategy_l3,
    created_by: fund.created_by,
    created_at: fund.created_at,
    nav_series: navHelpers().listCustomFundNavSeries(fund.product_code),
  }
}

export function buildCustomFundPrivateDetailResponse(fund: CustomFundRecord) {
  const strategy_l1 = fund.platform_strategy_l1 ?? fund.team_strategy_l1
  const strategy_l2 = fund.platform_strategy_l2 ?? fund.team_strategy_l2
  const strategy_l3 = fund.platform_strategy_l3 ?? fund.team_strategy_l3
  const { listCustomFundNavSeries, getCustomFundLatestNav, computeCustomFundHeadlineMetrics } = navHelpers()
  const navSeries = listCustomFundNavSeries(fund.product_code)
  const latestNav = getCustomFundLatestNav(fund.product_code)
  const headlineMetrics = computeCustomFundHeadlineMetrics(navSeries)
  return {
    is_custom_fund: true,
    info: {
      beian_hao: fund.product_code,
      product_name: fund.product_name,
      short_name: null,
      strategy_l1,
      strategy_l2,
      strategy_l3,
      manager: "",
      manager_names: null,
      scale: null,
      inception_date: navSeries[0]?.price_date ?? fund.created_at.slice(0, 10),
      benchmark: fund.benchmark_index,
      ret_1w: null,
      ret_1m: null,
      ret_3m: null,
      ret_6m: null,
      ret_1y: null,
      sharpe_1y: null,
      calmar_1y: null,
    },
    nav_series: navSeries,
    nav_data_source: "team" as const,
    metrics: {
      latest_nav: latestNav?.latest_nav ?? null,
      latest_nav_date: latestNav?.latest_nav_date ?? null,
      latest_cum_nav: latestNav?.cumulative_nav ?? null,
      latest_cum_nav_reinvested: navSeries[navSeries.length - 1]?.cum_nav_withdrawal ?? null,
      ...headlineMetrics,
    },
  }
}

export function tryGetCustomFundPrivateDetail(rawId: string, ownerUserId?: string) {
  const fund = getCustomFundByCode(rawId)
  if (!fund) return null
  if (fund.scope === "mine" && ownerUserId && fund.owner_user_id !== ownerUserId) {
    return null
  }
  return buildCustomFundPrivateDetailResponse(fund)
}
