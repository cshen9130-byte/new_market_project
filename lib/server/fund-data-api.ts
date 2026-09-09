/**
 * FOF99-shaped read API over our internal fund tables.
 * Used by /ma/api/fund-data/* and the fund-data MCP server.
 */

import { query } from "@/lib/db"
import {
  PRIVATE_FUND_TYPE_AMAC_VALUES,
  PRIVATE_FUND_TYPE_NAME_PATTERN,
  PRIVATE_FUND_TYPES_USING_FUTURES_TABLE,
  PRIVATE_FUND_WORKING_STATE_AMAC,
  type PrivateFundTypeLabel,
  type PrivateFundWorkingState,
} from "@/lib/ma/private-fund-type-filter"
import { lookupAmacFundMetadata } from "@/lib/server/amac-fund-metadata"
import {
  loadBasicinfoTrackByBeianKeys,
  resolveFundElementsBeianKeys,
} from "@/lib/server/fund-elements-lookup"
import { sqlPreferAmacOfficialName } from "@/lib/server/fund-name-match"
import {
  loadResolvedFundStrategies,
  sqlType6LatestStrategyJoin,
} from "@/lib/server/fund-strategy-resolve"
import {
  lookupManagerByRegistrationNo,
  lookupManagerForDetail,
} from "@/lib/server/private-fund-manager-query"
import { searchPrivateFundProductsForFastPicker } from "@/lib/server/private-fund-product-search"

export type FundDataOk<T> = { error_code: 0; msg: "success"; data: T }
export type FundDataErr = { error_code: number; msg: string; data: null }
export type FundDataEnvelope<T> = FundDataOk<T> | FundDataErr

export function fundDataOk<T>(data: T): FundDataOk<T> {
  return { error_code: 0, msg: "success", data }
}

export function fundDataErr(errorCode: number, msg: string): FundDataErr {
  return { error_code: errorCode, msg, data: null }
}

const FOF99_FUND_TYPE_TO_LABEL: Record<number, PrivateFundTypeLabel> = {
  2: "私募证券基金",
  3: "券商资管",
  12: "券商资管",
  5: "保险资管",
  6: "信托产品",
  13: "信托产品",
  8: "公募专户",
  16: "公募专户",
  9: "期货资管",
  17: "期货资管",
  14: "私募资产配置基金",
}

const AMAC_TYPE_TO_FOF99: Record<string, number> = {
  私募证券投资基金: 2,
  证券公司及其子公司的资产管理计划: 3,
  保险公司及其子公司的资产管理计划: 5,
  信托计划: 6,
  基金专户: 8,
  期货公司及其子公司的资产管理计划: 9,
  期货公司集合资管产品: 9,
  私募资产配置基金: 14,
}

const FOF99_STATE_TO_LABEL: Record<number, PrivateFundWorkingState> = {
  1: "正常运作",
  2: "正常清算",
  3: "提前清算",
  4: "延期清算",
  5: "投顾协议已终止",
  6: "非正常清算",
}

const AMAC_STATE_TO_FOF99: Record<string, number> = {
  正在运作: 1,
  正常运作: 1,
  正常清算: 2,
  提前清算: 3,
  延期清算: 4,
  投顾协议已终止: 5,
  已终止: 5,
  非正常清算: 6,
  已注销: 6,
}

const PRICE_ORDER_BY: Record<string, string> = {
  price_date: "price_date",
  nav: "nav",
  cumulative_nav: "cumulative_nav",
  cumulative_nav_withdrawal: "cum_nav_withdrawal",
  price_change: "price_change",
}

const LIST_ORDER_BY: Record<string, string> = {
  price_date: "latest_nav_date",
  inception_date: "inception_date",
  price_nav: "latest_nav",
  price_cnw: "latest_nav",
  price_cw_nav: "latest_nav",
  price_change: "ret_1w",
  product_name: "product_name",
  ret_1w: "ret_1w",
  ret_1m: "ret_1m",
  ret_3m: "ret_3m",
  ret_6m: "ret_6m",
  ret_1y: "ret_1y",
  sharpe_1y: "sharpe_1y",
  calmar_1y: "calmar_1y",
}

const UNLIMITED_STRATEGY = new Set(["", "不限", "全部", "*"])

function isUnlimited(value: string | null | undefined): boolean {
  return UNLIMITED_STRATEGY.has(String(value ?? "").trim())
}

function parseIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null
  const normalized = raw.trim().replace(/\//g, "-")
  const m = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!m) return null
  const yyyy = m[1]
  const mm = m[2].padStart(2, "0")
  const dd = m[3].padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

function parseOrderAsc(order: string | number | null | undefined): boolean {
  return String(order ?? "1") === "1"
}

function toNum(value: unknown): number | null {
  if (value == null || value === "") return null
  const n = typeof value === "number" ? value : parseFloat(String(value))
  return Number.isFinite(n) ? n : null
}

function toText(value: unknown): string {
  if (value == null) return ""
  return String(value)
}

function fmtDate(value: unknown): string {
  if (value == null) return ""
  return String(value).slice(0, 10)
}

function parseIntParam(raw: string | number | null | undefined, fallback: number): number {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10)
  return Number.isFinite(n) ? n : fallback
}

function splitRegCodes(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(/[,，;\s]+/)) {
    const code = part.trim()
    if (!code) continue
    const key = code.toUpperCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(code)
  }
  return out
}

function fof99FundType(amacType: string | null | undefined): number {
  const key = String(amacType ?? "").trim()
  return AMAC_TYPE_TO_FOF99[key] ?? 2
}

function fof99FundState(amacState: string | null | undefined): number {
  const key = String(amacState ?? "").trim()
  return AMAC_STATE_TO_FOF99[key] ?? 0
}

export async function resolveFundRegCode(raw: string): Promise<string | null> {
  const code = raw.trim()
  if (!code) return null
  const exact = await query<{ beian_hao: string }>(
    `SELECT beian_hao FROM (
       SELECT beian_hao FROM private_fund_info WHERE UPPER(BTRIM(beian_hao)) = UPPER($1)
       UNION ALL
       SELECT beian_hao FROM private_fund_info_bfl WHERE UPPER(BTRIM(beian_hao)) = UPPER($1)
     ) t
     LIMIT 1`,
    [code],
  ).catch(() => [])
  if (exact[0]?.beian_hao) return exact[0].beian_hao

  const hits = await searchPrivateFundProductsForFastPicker(code, 1).catch(() => [])
  return hits[0]?.beian_hao?.trim() || null
}

type InfoCoreRow = {
  beian_hao: string
  product_name: string | null
  short_name: string | null
  manager: string | null
  inception_date: string | null
  latest_nav: string | null
  latest_nav_date: string | null
  ret_1w: string | null
  ret_1m: string | null
  ret_3m: string | null
  ret_6m: string | null
  ret_1y: string | null
  sharpe_1y: string | null
  calmar_1y: string | null
  amac_fund_name: string | null
  amac_manager: string | null
  amac_mandator: string | null
  amac_establish: string | null
  amac_puton: string | null
  amac_fund_type: string | null
  amac_working_state: string | null
}

type TrackRow = {
  fund_name: string | null
  fund_short_name: string | null
  advisor: string | null
  inception_date: string | null
  puton_date: string | null
  mandator_name: string | null
  open_day: string | null
  is_temporary_open: number | null
  fee_purchase: string | null
  add_amount: string | null
  fee_redeem: string | null
  precautious_line: string | null
  closed_period: string | null
  stop_line: string | null
  fee_manage_rate: string | null
  fee_trust: string | null
  fee_manage: string | null
  fee_admin_service: string | null
  fee_pay: string | null
  manager_names: string | null
}

async function loadInfoCore(beianHao: string): Promise<InfoCoreRow | null> {
  const nameExpr = sqlPreferAmacOfficialName("i.product_name", "a.fund_name")
  const rows = await query<InfoCoreRow>(
    `SELECT
       i.beian_hao,
       ${nameExpr} AS product_name,
       b.short_name,
       COALESCE(NULLIF(BTRIM(i.manager), ''), NULLIF(BTRIM(a.manager_name), '')) AS manager,
       i.inception_date::text AS inception_date,
       i.latest_nav::text AS latest_nav,
       i.latest_nav_date::text AS latest_nav_date,
       i.ret_1w::text AS ret_1w,
       i.ret_1m::text AS ret_1m,
       i.ret_3m::text AS ret_3m,
       i.ret_6m::text AS ret_6m,
       i.ret_1y::text AS ret_1y,
       i.sharpe_1y::text AS sharpe_1y,
       i.calmar_1y::text AS calmar_1y,
       NULLIF(BTRIM(a.fund_name), '') AS amac_fund_name,
       NULLIF(BTRIM(a.manager_name), '') AS amac_manager,
       NULLIF(BTRIM(a.mandator_name), '') AS amac_mandator,
       a.establish_date::text AS amac_establish,
       a.put_on_record_date::text AS amac_puton,
       NULLIF(BTRIM(a.fund_type), '') AS amac_fund_type,
       NULLIF(BTRIM(a.working_state), '') AS amac_working_state
     FROM private_fund_info i
     LEFT JOIN amac_private_funds a ON UPPER(BTRIM(a.fund_no)) = UPPER(BTRIM(i.beian_hao))
     LEFT JOIN private_fund_info_bfl b ON UPPER(BTRIM(b.beian_hao)) = UPPER(BTRIM(i.beian_hao))
     WHERE UPPER(BTRIM(i.beian_hao)) = UPPER($1)
     LIMIT 1`,
    [beianHao],
  ).catch(() => [])
  if (rows[0]) return rows[0]

  const bfl = await query<InfoCoreRow>(
    `SELECT
       b.beian_hao,
       b.product_name,
       b.short_name,
       NULLIF(BTRIM(b.investment_advisor), '') AS manager,
       b.inception_date::text AS inception_date,
       NULL::text AS latest_nav,
       NULL::text AS latest_nav_date,
       NULL::text AS ret_1w,
       NULL::text AS ret_1m,
       NULL::text AS ret_3m,
       NULL::text AS ret_6m,
       NULL::text AS ret_1y,
       NULL::text AS sharpe_1y,
       NULL::text AS calmar_1y,
       NULLIF(BTRIM(a.fund_name), '') AS amac_fund_name,
       NULLIF(BTRIM(a.manager_name), '') AS amac_manager,
       NULLIF(BTRIM(a.mandator_name), '') AS amac_mandator,
       a.establish_date::text AS amac_establish,
       a.put_on_record_date::text AS amac_puton,
       NULLIF(BTRIM(a.fund_type), '') AS amac_fund_type,
       NULLIF(BTRIM(a.working_state), '') AS amac_working_state
     FROM private_fund_info_bfl b
     LEFT JOIN amac_private_funds a ON UPPER(BTRIM(a.fund_no)) = UPPER(BTRIM(b.beian_hao))
     WHERE UPPER(BTRIM(b.beian_hao)) = UPPER($1)
     LIMIT 1`,
    [beianHao],
  ).catch(() => [])
  return bfl[0] ?? null
}

async function loadTrackRow(beianHao: string): Promise<TrackRow | null> {
  try {
    const keys = await resolveFundElementsBeianKeys(beianHao)
    const rows = await loadBasicinfoTrackByBeianKeys<TrackRow>(
      keys,
      `SELECT fund_name, fund_short_name, advisor,
              inception_date::text, puton_date::text, mandator_name,
              open_day, is_temporary_open,
              fee_purchase, add_amount, fee_redeem,
              precautious_line, closed_period, stop_line,
              fee_manage_rate::text, fee_trust, fee_manage,
              fee_admin_service, fee_pay, manager_names
       FROM basicinfo_bfl_track`,
    )
    return rows[0] ?? null
  } catch {
    return null
  }
}

function parseManagerNames(raw: string | null | undefined): { name: string; id: string }[] {
  const text = String(raw ?? "").trim()
  if (!text) return []
  return text
    .split(/[,，;；、|/]+/)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ name, id: "" }))
}

export async function getFundInfo(regCode: string): Promise<FundDataEnvelope<Record<string, unknown>>> {
  const resolved = await resolveFundRegCode(regCode)
  if (!resolved) return fundDataErr(2, `fund not found: ${regCode}`)

  const [core, track, strategies, amac] = await Promise.all([
    loadInfoCore(resolved),
    loadTrackRow(resolved),
    loadResolvedFundStrategies(resolved).catch(() => null),
    lookupAmacFundMetadata(resolved).catch(() => null),
  ])
  if (!core && !track && !amac) return fundDataErr(2, `fund not found: ${regCode}`)

  const fundName =
    track?.fund_name?.trim() ||
    amac?.fund_name?.trim() ||
    core?.amac_fund_name?.trim() ||
    core?.product_name?.trim() ||
    resolved
  const advisor =
    track?.advisor?.trim() ||
    core?.manager?.trim() ||
    amac?.manager_name?.trim() ||
    core?.amac_manager?.trim() ||
    ""
  const mandator =
    track?.mandator_name?.trim() ||
    amac?.mandator_name?.trim() ||
    core?.amac_mandator?.trim() ||
    ""

  return fundDataOk({
    fund_name: fundName,
    fund_short_name: track?.fund_short_name?.trim() || core?.short_name?.trim() || "",
    fund_type: fof99FundType(core?.amac_fund_type),
    fund_type_name: core?.amac_fund_type || "",
    advisor,
    advisor2: advisor,
    register_number: resolved,
    inception_date: fmtDate(track?.inception_date || core?.inception_date || amac?.establish_date || core?.amac_establish),
    puton_date: fmtDate(track?.puton_date || amac?.put_on_record_date || core?.amac_puton),
    mandator_name: mandator,
    managers: parseManagerNames(track?.manager_names),
    FundsBase: {
      open_day: track?.open_day ?? "",
      is_temporary_open: track?.is_temporary_open ?? 0,
      fee_purchase: track?.fee_purchase ?? "",
      add_amount: track?.add_amount ?? "",
      fee_redeem: track?.fee_redeem ?? "",
      precautious_line: track?.precautious_line ?? "",
      closed_period: track?.closed_period ?? "",
      stop_line: track?.stop_line ?? "",
      fee_manage_rate: toNum(track?.fee_manage_rate) ?? 0,
      fee_trust: track?.fee_trust ?? "",
      fee_manage: track?.fee_manage ?? "",
      fee_admin_service: track?.fee_admin_service ?? "",
      fee_pay: track?.fee_pay ?? "",
      scale: amac?.mgmt_scale ?? "",
      register_code: amac?.registration_no ?? "",
    },
    strategy: {
      company: {
        strategy_one: strategies?.company.l1 ?? "",
        strategy_two: strategies?.company.l2 ?? "",
        strategy_three: strategies?.company.l3 ?? "",
      },
      platform: {
        strategy_one: strategies?.platform.l1 ?? "",
        strategy_two: strategies?.platform.l2 ?? "",
        strategy_three: strategies?.platform.l3 ?? "",
      },
    },
    latest_nav: toNum(core?.latest_nav),
    latest_nav_date: fmtDate(core?.latest_nav_date),
    fund_state: fof99FundState(core?.amac_working_state),
    fund_state_name: core?.amac_working_state || "",
  })
}

export type FundPricePoint = {
  nav: number | null
  cumulative_nav_withdrawal: number | null
  cumulative_nav: number | null
  price_change: number | null
  price_date: string
  reg_code?: string
}

function mapPriceRow(row: {
  nav: string | null
  cumulative_nav: string | null
  cum_nav_withdrawal: string | null
  price_change: string | null
  price_date: string
  beian_hao?: string
}): FundPricePoint {
  return {
    nav: toNum(row.nav),
    cumulative_nav_withdrawal: toNum(row.cum_nav_withdrawal),
    cumulative_nav: toNum(row.cumulative_nav),
    price_change: toNum(row.price_change),
    price_date: fmtDate(row.price_date),
    ...(row.beian_hao ? { reg_code: row.beian_hao } : {}),
  }
}

export async function getFundPrice(options: {
  reg_code: string
  start_date?: string | null
  end_date?: string | null
  order?: string | number | null
  order_by?: string | null
}): Promise<FundDataEnvelope<FundPricePoint[]>> {
  const resolved = await resolveFundRegCode(options.reg_code)
  if (!resolved) return fundDataErr(2, `fund not found: ${options.reg_code}`)

  const start = parseIsoDate(options.start_date)
  const end = parseIsoDate(options.end_date)
  const orderBy = PRICE_ORDER_BY[String(options.order_by ?? "price_date")] ?? "price_date"
  const asc = parseOrderAsc(options.order)

  const rows = await query<{
    nav: string | null
    cumulative_nav: string | null
    cum_nav_withdrawal: string | null
    price_change: string | null
    price_date: string
  }>(
    `SELECT nav::text, cumulative_nav::text, cum_nav_withdrawal::text,
            price_change::text, price_date::text
     FROM private_fund_nav
     WHERE UPPER(BTRIM(beian_hao)) = UPPER($1)
       AND ($2::date IS NULL OR price_date >= $2::date)
       AND ($3::date IS NULL OR price_date <= $3::date)
       AND nav IS NOT NULL AND nav > 0
     ORDER BY ${orderBy} ${asc ? "ASC" : "DESC"}
     LIMIT 5000`,
    [resolved, start, end],
  )

  return fundDataOk(rows.map(mapPriceRow))
}

export async function getFundMultiPrice(options: {
  reg_code: string
  date?: string | null
  order?: string | number | null
  order_by?: string | null
}): Promise<FundDataEnvelope<FundPricePoint[]>> {
  const codes = splitRegCodes(options.reg_code)
  if (codes.length === 0) return fundDataErr(1, "reg_code is required")
  if (codes.length > 40) return fundDataErr(1, "reg_code supports at most 40 funds")

  const resolvedPairs = await Promise.all(
    codes.map(async (code) => ({ code, resolved: await resolveFundRegCode(code) })),
  )
  const resolved = [...new Set(resolvedPairs.map((p) => p.resolved).filter((v): v is string => Boolean(v)))]
  if (resolved.length === 0) return fundDataErr(2, "no matching funds")

  const onDate = parseIsoDate(options.date)
  const orderBy = PRICE_ORDER_BY[String(options.order_by ?? "nav")] ?? "nav"
  const asc = parseOrderAsc(options.order ?? "0")

  const rows = await query<{
    beian_hao: string
    nav: string | null
    cumulative_nav: string | null
    cum_nav_withdrawal: string | null
    price_change: string | null
    price_date: string
  }>(
    onDate
      ? `SELECT DISTINCT ON (UPPER(BTRIM(beian_hao)))
           beian_hao, nav::text, cumulative_nav::text, cum_nav_withdrawal::text,
           price_change::text, price_date::text
         FROM private_fund_nav
         WHERE UPPER(BTRIM(beian_hao)) = ANY($1::text[])
           AND price_date <= $2::date
           AND nav IS NOT NULL AND nav > 0
         ORDER BY UPPER(BTRIM(beian_hao)), price_date DESC`
      : `SELECT DISTINCT ON (UPPER(BTRIM(beian_hao)))
           beian_hao, nav::text, cumulative_nav::text, cum_nav_withdrawal::text,
           price_change::text, price_date::text
         FROM private_fund_nav
         WHERE UPPER(BTRIM(beian_hao)) = ANY($1::text[])
           AND nav IS NOT NULL AND nav > 0
         ORDER BY UPPER(BTRIM(beian_hao)), price_date DESC`,
    onDate ? [resolved.map((c) => c.toUpperCase()), onDate] : [resolved.map((c) => c.toUpperCase())],
  )

  const sorted = rows
    .map(mapPriceRow)
    .sort((a, b) => {
      const key = orderBy === "price_date" ? "price_date" : orderBy === "cumulative_nav" ? "cumulative_nav"
        : orderBy === "cum_nav_withdrawal" ? "cumulative_nav_withdrawal"
        : orderBy === "price_change" ? "price_change" : "nav"
      const av = key === "price_date" ? a.price_date : (a[key as keyof FundPricePoint] as number | null) ?? 0
      const bv = key === "price_date" ? b.price_date : (b[key as keyof FundPricePoint] as number | null) ?? 0
      if (av < bv) return asc ? -1 : 1
      if (av > bv) return asc ? 1 : -1
      return 0
    })

  return fundDataOk(sorted)
}

export async function getFundView(regCode: string): Promise<FundDataEnvelope<Record<string, unknown>>> {
  const info = await getFundInfo(regCode)
  if (info.error_code !== 0) return info
  const core = await loadInfoCore(String(info.data.register_number))
  return fundDataOk({
    register_number: info.data.register_number,
    fund_name: info.data.fund_name,
    latest_nav: toNum(core?.latest_nav),
    latest_nav_date: fmtDate(core?.latest_nav_date),
    ret_1w: toNum(core?.ret_1w),
    ret_1m: toNum(core?.ret_1m),
    ret_3m: toNum(core?.ret_3m),
    ret_6m: toNum(core?.ret_6m),
    ret_1y: toNum(core?.ret_1y),
    sharpe_1y: toNum(core?.sharpe_1y),
    calmar_1y: toNum(core?.calmar_1y),
    strategy: info.data.strategy,
  })
}

export async function searchFunds(q: string, limit = 8): Promise<FundDataEnvelope<{
  products: Array<{
    register_number: string
    fund_name: string
    fund_short_name: string
    strategy_one: string
  }>
  managers: Array<{ registration_no: string; manager_name: string }>
}>> {
  const keyword = q.trim()
  if (!keyword) return fundDataOk({ products: [], managers: [] })
  const take = Math.min(Math.max(parseIntParam(limit, 8), 1), 40)

  const [products, managers] = await Promise.all([
    searchPrivateFundProductsForFastPicker(keyword, take).catch(() => []),
    query<{ registration_no: string; manager_name: string }>(
      `SELECT registration_no, manager_name
       FROM (
         SELECT registration_no, manager_name
         FROM amac_managers
         WHERE TRIM(COALESCE(manager_name, '')) <> ''
           AND (manager_name ILIKE $1 OR registration_no ILIKE $1)
         UNION
         SELECT registration_no, manager_name
         FROM private_fund_managers_list
         WHERE TRIM(COALESCE(manager_name, '')) <> ''
           AND TRIM(COALESCE(registration_no, '')) <> ''
           AND (manager_name ILIKE $1 OR registration_no ILIKE $1)
       ) t
       ORDER BY
         CASE
           WHEN registration_no ILIKE $2 THEN 0
           WHEN manager_name ILIKE $2 THEN 1
           ELSE 2
         END,
         LENGTH(manager_name) ASC
       LIMIT $3`,
      [`%${keyword}%`, `${keyword}%`, take],
    ).catch(() => []),
  ])

  return fundDataOk({
    products: products.map((p) => ({
      register_number: p.beian_hao,
      fund_name: p.product_name,
      fund_short_name: p.short_name ?? "",
      strategy_one: p.strategy_one ?? "",
    })),
    managers,
  })
}

export async function getFundAdvancedList(options: {
  strategy_one?: string | null
  strategy_two?: string | null
  strategy_three?: string | null
  type?: string | number | null
  page?: string | number | null
  pagesize?: string | number | null
  order?: string | number | null
  order_by?: string | null
  fund_state?: string | number | null
  fund_type?: string | number | null
  keyword?: string | null
}): Promise<FundDataEnvelope<{ list: Record<string, unknown>[]; total: number; page: number; pagesize: number }>> {
  const page = Math.max(1, parseIntParam(options.page, 1))
  const pagesize = Math.min(1000, Math.max(1, parseIntParam(options.pagesize, 10)))
  const offset = (page - 1) * pagesize
  const strategySource = String(options.type ?? "1") === "2" ? "company" : "platform"
  const orderByCol = LIST_ORDER_BY[String(options.order_by ?? "price_date")] ?? "latest_nav_date"
  const asc = parseOrderAsc(options.order ?? "0")
  const l1 = String(options.strategy_one ?? "").trim()
  const l2 = String(options.strategy_two ?? "").trim()
  const l3 = String(options.strategy_three ?? "").trim()
  const keyword = String(options.keyword ?? "").trim()

  const nameExpr = sqlPreferAmacOfficialName("i.product_name", "a.fund_name")
  const teamJoin = sqlType6LatestStrategyJoin("i.beian_hao", "t6")
  const amacL1 = `NULLIF(NULLIF(BTRIM(i.strategy_l1), ''), '-')`
  const amacL2 = `NULLIF(NULLIF(BTRIM(i.strategy_l2), ''), '-')`
  const l1Expr = strategySource === "platform"
    ? `COALESCE(t6.platform_l1, ${amacL1})`
    : `t6.company_l1`
  const l2Expr = strategySource === "platform"
    ? `COALESCE(t6.platform_l2, ${amacL2})`
    : `t6.company_l2`
  const l3Expr = strategySource === "platform" ? `t6.platform_l3` : `t6.company_l3`

  const where: string[] = []
  const params: unknown[] = []

  if (!isUnlimited(l1)) {
    params.push(l1)
    where.push(`${l1Expr} = $${params.length}`)
  }
  if (!isUnlimited(l2)) {
    params.push(l2)
    where.push(`${l2Expr} = $${params.length}`)
  }
  if (!isUnlimited(l3)) {
    params.push(`%${l3}%`)
    where.push(`COALESCE(${l3Expr}, '') ILIKE $${params.length}`)
  }
  if (keyword) {
    params.push(`%${keyword}%`)
    where.push(`(
      i.product_name ILIKE $${params.length}
      OR i.beian_hao ILIKE $${params.length}
      OR COALESCE(a.fund_name, '') ILIKE $${params.length}
      OR COALESCE(i.manager, '') ILIKE $${params.length}
    )`)
  }

  const fundTypeNum = options.fund_type == null || options.fund_type === ""
    ? null
    : parseIntParam(options.fund_type, NaN)
  if (Number.isFinite(fundTypeNum) && FOF99_FUND_TYPE_TO_LABEL[fundTypeNum as number]) {
    const label = FOF99_FUND_TYPE_TO_LABEL[fundTypeNum as number]
    const typeParts: string[] = []
    const amacValues = PRIVATE_FUND_TYPE_AMAC_VALUES[label]
    if (amacValues.length > 0) {
      params.push(amacValues)
      typeParts.push(`a.fund_type = ANY($${params.length})`)
    }
    const namePat = PRIVATE_FUND_TYPE_NAME_PATTERN[label]
    if (namePat) {
      params.push(`%${namePat}%`)
      typeParts.push(`i.product_name ILIKE $${params.length}`)
    }
    if (PRIVATE_FUND_TYPES_USING_FUTURES_TABLE.has(label)) {
      typeParts.push(`EXISTS (
        SELECT 1 FROM amac_futures_products _fut
        WHERE _fut.fund_no = i.beian_hao
      )`)
    }
    if (typeParts.length > 0) where.push(`(${typeParts.join(" OR ")})`)
  }

  const stateNum = options.fund_state == null || options.fund_state === ""
    ? null
    : parseIntParam(options.fund_state, NaN)
  if (Number.isFinite(stateNum) && FOF99_STATE_TO_LABEL[stateNum as number]) {
    const label = FOF99_STATE_TO_LABEL[stateNum as number]
    const amacStates = PRIVATE_FUND_WORKING_STATE_AMAC[label]
    if (amacStates.length > 0) {
      params.push(amacStates)
      where.push(`(
        a.working_state = ANY($${params.length})
        OR EXISTS (
          SELECT 1 FROM amac_futures_products _wsf
          WHERE _wsf.fund_no = i.beian_hao
            AND _wsf.working_state = ANY($${params.length})
        )
      )`)
    }
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""
  const fromSql = `
    FROM private_fund_info i
    LEFT JOIN amac_private_funds a ON a.fund_no = i.beian_hao
    ${teamJoin}
    LEFT JOIN LATERAL (
      SELECT short_name FROM private_fund_info_bfl bfl
      WHERE bfl.beian_hao = i.beian_hao
      LIMIT 1
    ) b ON true
    ${whereSql}
  `

  const countRows = await query<{ n: string }>(`SELECT COUNT(*)::text AS n ${fromSql}`, params)
  const total = parseInt(countRows[0]?.n ?? "0", 10) || 0

  params.push(pagesize, offset)
  const rows = await query<{
    beian_hao: string
    product_name: string
    short_name: string | null
    manager: string | null
    inception_date: string | null
    latest_nav: string | null
    latest_nav_date: string | null
    ret_1w: string | null
    puton_date: string | null
    mandator_name: string | null
    fund_type: string | null
    working_state: string | null
    amac_scale: string | null
    register_code: string | null
    strategy_one: string | null
    strategy_two: string | null
    strategy_three: string | null
  }>(
    `SELECT
       i.beian_hao,
       ${nameExpr} AS product_name,
       b.short_name,
       COALESCE(NULLIF(BTRIM(i.manager), ''), NULLIF(BTRIM(a.manager_name), '')) AS manager,
       i.inception_date::text AS inception_date,
       i.latest_nav::text AS latest_nav,
       i.latest_nav_date::text AS latest_nav_date,
       i.ret_1w::text AS ret_1w,
       a.put_on_record_date::text AS puton_date,
       NULLIF(BTRIM(a.mandator_name), '') AS mandator_name,
       NULLIF(BTRIM(a.fund_type), '') AS fund_type,
       NULLIF(BTRIM(a.working_state), '') AS working_state,
       NULL::text AS amac_scale,
       NULL::text AS register_code,
       ${l1Expr} AS strategy_one,
       ${l2Expr} AS strategy_two,
       ${l3Expr} AS strategy_three
     ${fromSql}
     ORDER BY i.${orderByCol} ${asc ? "ASC NULLS LAST" : "DESC NULLS LAST"}, i.beian_hao
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )

  const list = rows.map((row) => ({
    fund_name: row.product_name,
    fund_short_name: row.short_name ?? "",
    register_number: row.beian_hao,
    advisor: row.manager ?? "",
    advisor2: row.manager ?? "",
    inception_date: fmtDate(row.inception_date),
    liquidate_date: "",
    price_cw_nav: toNum(row.latest_nav) ?? 0,
    price_nav: toNum(row.latest_nav) ?? 0,
    price_cnw: toNum(row.latest_nav) ?? 0,
    price_change: toNum(row.ret_1w) ?? 0,
    price_date: fmtDate(row.latest_nav_date),
    puton_date: fmtDate(row.puton_date),
    fund_type: fof99FundType(row.fund_type),
    fund_state: fof99FundState(row.working_state),
    cycle_type: 0,
    mandator_name: row.mandator_name ?? "",
    strategy_one: row.strategy_one ?? "",
    strategy_two: row.strategy_two ?? "",
    strategy_three: row.strategy_three ?? "",
    strategy_verify: 0,
    amac_scale: row.amac_scale ?? "",
    register_code: row.register_code ?? "",
  }))

  return fundDataOk({ list, total, page, pagesize })
}

export async function getCompanyInfo(options: {
  code?: string | null
  name_cn?: string | null
  name_short?: string | null
}): Promise<FundDataEnvelope<Record<string, unknown>>> {
  const code = String(options.code ?? "").trim()
  const name = String(options.name_cn || options.name_short || "").trim()
  if (!code && !name) return fundDataErr(1, "code or name_cn is required")

  const manager = code
    ? await lookupManagerByRegistrationNo(code)
    : await lookupManagerForDetail("", name)

  if (!manager) return fundDataErr(2, `company not found: ${code || name}`)

  return fundDataOk({
    name_cn: manager.manager_name,
    register_code: manager.registration_no,
    found_date: manager.inception_date ?? "",
    scale: manager.mgmt_scale ?? "",
    member_type: manager.member_type ?? "",
    core_strategy: manager.core_strategy ?? "",
    active_product_count: manager.active_product_count ?? 0,
  })
}

export async function getCompanyFundList(options: {
  code?: string | null
  page?: string | number | null
  pagesize?: string | number | null
  fund_state?: string | number | null
}): Promise<FundDataEnvelope<{ list: Record<string, unknown>[]; total: number; page: number; pagesize: number }>> {
  const code = String(options.code ?? "").trim()
  if (!code) return fundDataErr(1, "code is required")

  const manager = await lookupManagerByRegistrationNo(code)
  if (!manager) return fundDataErr(2, `company not found: ${code}`)

  const page = Math.max(1, parseIntParam(options.page, 1))
  const pagesize = Math.min(200, Math.max(1, parseIntParam(options.pagesize, 20)))
  const offset = (page - 1) * pagesize
  const nameLike = `%${manager.manager_name}%`

  const stateNum = options.fund_state == null || options.fund_state === "" || String(options.fund_state) === "0"
    ? null
    : parseIntParam(options.fund_state, NaN)
  const stateValues = Number.isFinite(stateNum) && FOF99_STATE_TO_LABEL[stateNum as number]
    ? PRIVATE_FUND_WORKING_STATE_AMAC[FOF99_STATE_TO_LABEL[stateNum as number]]
    : null
  const stateClause = stateValues
    ? `AND a.working_state = ANY($3::text[])`
    : ""

  const baseParams: unknown[] = [manager.manager_name, nameLike]
  if (stateValues) baseParams.push(stateValues)

  const countRows = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM private_fund_info i
     LEFT JOIN amac_private_funds a ON a.fund_no = i.beian_hao
     WHERE (
       i.manager = $1
       OR i.manager ILIKE $2
       OR a.manager_name = $1
       OR UPPER(BTRIM(COALESCE(a.fund_no, ''))) IN (
         SELECT UPPER(BTRIM(fund_no)) FROM amac_private_funds
         WHERE manager_name = $1
       )
     )
     ${stateClause}`,
    baseParams,
  )
  const total = parseInt(countRows[0]?.n ?? "0", 10) || 0

  const listParams: unknown[] = [...baseParams, pagesize, offset]
  const limitIdx = listParams.length - 1
  const offsetIdx = listParams.length

  const rows = await query<{
    beian_hao: string
    product_name: string
    inception_date: string | null
    latest_nav: string | null
    latest_nav_date: string | null
    working_state: string | null
    fund_type: string | null
  }>(
    `SELECT
       i.beian_hao,
       ${sqlPreferAmacOfficialName("i.product_name", "a.fund_name")} AS product_name,
       i.inception_date::text AS inception_date,
       i.latest_nav::text AS latest_nav,
       i.latest_nav_date::text AS latest_nav_date,
       NULLIF(BTRIM(a.working_state), '') AS working_state,
       NULLIF(BTRIM(a.fund_type), '') AS fund_type
     FROM private_fund_info i
     LEFT JOIN amac_private_funds a ON a.fund_no = i.beian_hao
     WHERE (
       i.manager = $1
       OR i.manager ILIKE $2
       OR a.manager_name = $1
       OR UPPER(BTRIM(COALESCE(a.fund_no, ''))) IN (
         SELECT UPPER(BTRIM(fund_no)) FROM amac_private_funds
         WHERE manager_name = $1
       )
     )
     ${stateClause}
     ORDER BY i.latest_nav_date DESC NULLS LAST, i.beian_hao
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    listParams,
  )

  return fundDataOk({
    list: rows.map((row) => ({
      fund_name: row.product_name,
      register_number: row.beian_hao,
      inception_date: fmtDate(row.inception_date),
      price_nav: toNum(row.latest_nav) ?? 0,
      price_date: fmtDate(row.latest_nav_date),
      fund_type: fof99FundType(row.fund_type),
      fund_state: fof99FundState(row.working_state),
    })),
    total,
    page,
    pagesize,
  })
}

export const FUND_DATA_CATALOG = {
  endpoints: [
    { path: "/fund/info", tool: "fund_info", desc: "私募基金基本信息 (FOF99 FundInfo)" },
    { path: "/price", tool: "fund_price", desc: "单基金净值序列 (FOF99 FundPrice)" },
    { path: "/fund/price", tool: "fund_multi_price", desc: "多基金净值，最多 40 只 (FOF99 FundMultiPrice)" },
    { path: "/fund/advancedlist", tool: "fund_advanced_list", desc: "按策略筛选基金列表 (FOF99 FundAdvancedList)" },
    { path: "/fund/view", tool: "fund_view", desc: "业绩指标 (FOF99 FundView)" },
    { path: "/fund/search", tool: "fund_search", desc: "按名称/备案号搜索基金与管理人" },
    { path: "/company/info", tool: "company_info", desc: "管理人信息 (FOF99 CompanyInfo)" },
    { path: "/company/fund/list", tool: "company_fund_list", desc: "管理人旗下基金 (FOF99 CompanyFundList)" },
  ],
}

export async function handleFundDataRequest(
  path: string,
  params: Record<string, string | undefined>,
): Promise<FundDataEnvelope<unknown>> {
  const key = path.replace(/^\/+|\/+$/g, "")
  switch (key) {
    case "":
    case "catalog":
      return fundDataOk(FUND_DATA_CATALOG)
    case "fund/info":
      if (!params.reg_code) return fundDataErr(1, "reg_code is required")
      return getFundInfo(params.reg_code)
    case "price":
      if (!params.reg_code) return fundDataErr(1, "reg_code is required")
      return getFundPrice(params)
    case "fund/price":
      if (!params.reg_code) return fundDataErr(1, "reg_code is required")
      return getFundMultiPrice(params)
    case "fund/advancedlist":
      return getFundAdvancedList(params)
    case "fund/view":
      if (!params.reg_code) return fundDataErr(1, "reg_code is required")
      return getFundView(params.reg_code)
    case "fund/search":
      return searchFunds(params.q || params.keyword || "", parseIntParam(params.limit, 8))
    case "company/info":
      return getCompanyInfo(params)
    case "company/fund/list":
      return getCompanyFundList(params)
    default:
      return fundDataErr(1, `unknown endpoint: /${key}`)
  }
}

export function searchParamsToRecord(searchParams: URLSearchParams): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  for (const [key, value] of searchParams.entries()) {
    out[key] = value
  }
  if (!out.reg_code && out.register_number) out.reg_code = out.register_number
  if (!out.pagesize && out.page_size) out.pagesize = out.page_size
  if (!out.code && out.reg_code && !out.register_number) {
    // company endpoints use `code`
  }
  if (!out.code && (out.registration_no || out.register_code)) {
    out.code = out.registration_no || out.register_code
  }
  return out
}
