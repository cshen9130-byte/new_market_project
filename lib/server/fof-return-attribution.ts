/**
 * FOF 基金持仓收益归因：用估值表历史份额 × 净值变动，得到区间投资收益（元）
 * 及对组合收益 / 净值的贡献。不含股票、期货等非基金资产。
 */

import { query } from "@/lib/db"
import {
  extractListedFundCodeFromName,
  resolveFofValuationCodeAlias,
  resolveFundHoldingCode,
} from "@/lib/server/fund-holding-code"
import {
  isFundHoldingMergeCandidate,
  mergeSameProductFundHoldings,
} from "@/lib/server/fund-holding-merge"
import { resolveFundNames } from "@/lib/server/fund-nav-series"
import { resolveRouteFundId } from "@/lib/server/fof-underlying-query"
import { lookupManagedProductOverride, remapManagedProductBeianCode } from "@/lib/server/managed-product-beian"
import { ensureEmailValuationHoldingsTables } from "@/lib/server/email-valuation-holdings-pg"
import { ensureEmailValuationTable } from "@/lib/server/email-valuation-pg"
import {
  applyValuationHoldingDisplayName,
  isValuationNonProductHoldingName,
} from "@/lib/valuation-holding-display-name"

const MAX_DAILY_RETURN = 0.5

export type FofAttributionRow = {
  fundName: string
  beianHao: string | null
  valuationCode: string | null
  strategy: string | null
  strategyL2: string | null
  strategyL3: string | null
  fromDate: string
  toDate: string
  pnl: number
  returnContribution: number
  navContribution: number
}

export type FofAttributionResult = {
  fromDate: string
  toDate: string
  snapshotFrom: string | null
  snapshotTo: string | null
  earliestValuationDate: string | null
  startNav: number | null
  startPaidIn: number | null
  rows: FofAttributionRow[]
  totalPnl: number
  totalReturnContribution: number
  totalNavContribution: number
}

type RecordRow = {
  id: string
  valuation_date: string
  net_asset_value: string | null
  paid_in_capital: string | null
  unit_nav: string | null
}

type HoldingSqlRow = {
  valuation_record_id: string
  subject_name: string | null
  symbol: string | null
  subject_code: string | null
  original_subject_code: string | null
  row_kind: string | null
  quantity: string | null
  price: string | null
  market_value: string | null
  signed_market_value: string | null
  cost: string | null
  signed_cost: string | null
  is_leaf: boolean | null
  include_in_detail: boolean | null
}

type Position = {
  key: string
  fundName: string
  valuationCode: string | null
  qty: number
  price: number | null
  mv: number
  cost: number
}

type FundAcc = {
  fundName: string
  valuationCode: string | null
  pnl: number
}

function parseNum(value: string | number | null | undefined): number {
  if (value == null || value === "") return 0
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

function plausiblePrice(price: number, qty: number, mv: number): number | null {
  if (price > 0.05 && price < 500) return price
  if (qty > 0 && Math.abs(mv) > 0) {
    const implied = Math.abs(mv) / qty
    if (implied > 0.05 && implied < 500) return implied
  }
  return null
}

function isDirectEquityStock(row: HoldingSqlRow): boolean {
  const name = String(row.subject_name ?? "")
  if (/ETF/u.test(name)) return false
  const kind = row.row_kind ?? "other"
  if (kind === "stock" || kind === "derivative") return true
  if (kind === "fund_or_stock") {
    const code = (
      resolveFundHoldingCode(
        String(row.subject_code ?? ""),
        name,
        row.symbol,
        row.original_subject_code,
      ) ?? ""
    ).replace(/\.(SZ|SH|BJ)$/i, "").trim()
    if (!/^\d{6}$/.test(code)) return false
    if (/基金|私募|ETF/.test(name)) return false
    const subj = String(row.subject_code ?? "").replace(/\s/g, "")
    return subj.startsWith("1102") || subj.startsWith("1001")
  }
  return false
}

function holdingIdentity(row: HoldingSqlRow): { key: string; fundName: string; valuationCode: string | null } {
  const name = String(row.subject_name ?? row.symbol ?? "").trim()
  const valuationCode =
    resolveFofValuationCodeAlias(
      resolveFundHoldingCode(
        String(row.subject_code ?? ""),
        name,
        row.symbol,
        row.original_subject_code,
      ) ?? extractListedFundCodeFromName(name) ?? (String(row.symbol ?? "").trim() || null),
    ) ?? null
  const fundName = applyValuationHoldingDisplayName(name, valuationCode) || name
  if (valuationCode) return { key: `code:${valuationCode.toUpperCase()}`, fundName, valuationCode }
  return { key: `name:${fundName}`, fundName, valuationCode: null }
}

function toPosition(row: HoldingSqlRow): Position | null {
  if (isDirectEquityStock(row)) return null
  if (isValuationNonProductHoldingName(String(row.subject_name ?? ""))) return null
  const ident = holdingIdentity(row)
  if (!ident.fundName) return null
  const qty = parseNum(row.quantity)
  const mv = parseNum(row.signed_market_value) || parseNum(row.market_value)
  const cost = parseNum(row.signed_cost) || parseNum(row.cost)
  const price = plausiblePrice(parseNum(row.price), qty, mv)
  return {
    key: ident.key,
    fundName: ident.fundName,
    valuationCode: ident.valuationCode,
    qty,
    price,
    mv,
    cost,
  }
}

function dayPnl(prev: Position | undefined, curr: Position | undefined): number {
  const qty = prev?.qty ?? 0
  const p0 = prev?.price ?? null
  const p1 = curr?.price ?? null
  if (qty > 0 && p0 != null && p1 != null && p0 > 0) {
    const ret = (p1 - p0) / p0
    if (Math.abs(ret) <= MAX_DAILY_RETURN) return qty * (p1 - p0)
  }
  const mv0 = prev?.mv ?? 0
  const mv1 = curr?.mv ?? 0
  const cost0 = prev?.cost ?? 0
  const cost1 = curr?.cost ?? 0
  return mv1 - mv0 - (cost1 - cost0)
}

async function resolveCandidateCodes(rawBeianHao: string): Promise<{
  beian_hao: string
  product_name: string | null
  candidateCodes: string[]
}> {
  const beian_hao = await resolveRouteFundId(rawBeianHao)
  const names = await resolveFundNames(beian_hao)
  const product_name = names.product_name?.trim() || null
  const candidateCodes = new Set<string>([beian_hao])
  const remapped = remapManagedProductBeianCode(beian_hao)
  if (remapped) candidateCodes.add(remapped)
  const override = lookupManagedProductOverride(beian_hao)
  if (override?.beian_hao) candidateCodes.add(override.beian_hao)
  return { beian_hao, product_name, candidateCodes: [...candidateCodes] }
}

async function loadCompanyStrategyBatch(
  beianCodes: string[],
  productNames: string[],
): Promise<Map<string, { register_number: string | null; l1: string | null; l2: string | null; l3: string | null }>> {
  const out = new Map<string, { register_number: string | null; l1: string | null; l2: string | null; l3: string | null }>()
  const codes = [...new Set(beianCodes.map((c) => c.trim()).filter(Boolean))]
  if (codes.length > 0) {
    const rows = await query<{ register_number: string; l1: string | null; l2: string | null; l3: string | null }>(
      `SELECT DISTINCT ON (register_number)
         register_number,
         NULLIF(BTRIM(company_strategy_one), '') AS l1,
         NULLIF(BTRIM(company_strategy_two), '') AS l2,
         NULLIF(BTRIM(company_strategy_three), '') AS l3
       FROM type6_ops_team_full
       WHERE register_number = ANY($1::text[])
       ORDER BY register_number, updated_at DESC NULLS LAST, id DESC`,
      [codes],
    )
    for (const r of rows) {
      out.set(r.register_number, { register_number: r.register_number, l1: r.l1, l2: r.l2, l3: r.l3 })
    }
  }

  const names = [...new Set(productNames.flatMap((raw) => {
    const name = raw.trim()
    if (!name) return []
    const stripped = name.replace(/私募证券投资基金/g, "").replace(/私募基金/g, "").trim()
    return [name, stripped, stripped ? `${stripped}私募证券投资基金` : ""].filter(Boolean)
  }))].slice(0, 40)
  if (names.length === 0) return out

  const rows = await query<{
    register_number: string
    fund_name: string | null
    fund_short_name: string | null
    l1: string | null
    l2: string | null
    l3: string | null
  }>(
    `SELECT DISTINCT ON (COALESCE(NULLIF(BTRIM(fund_name), ''), NULLIF(BTRIM(fund_short_name), '')))
       register_number,
       fund_name,
       fund_short_name,
       NULLIF(BTRIM(company_strategy_one), '') AS l1,
       NULLIF(BTRIM(company_strategy_two), '') AS l2,
       NULLIF(BTRIM(company_strategy_three), '') AS l3
     FROM type6_ops_team_full
     WHERE BTRIM(COALESCE(fund_name, '')) = ANY($1::text[])
        OR BTRIM(COALESCE(fund_short_name, '')) = ANY($1::text[])
     ORDER BY COALESCE(NULLIF(BTRIM(fund_name), ''), NULLIF(BTRIM(fund_short_name), '')),
              updated_at DESC NULLS LAST, id DESC`,
    [names],
  )
  for (const r of rows) {
    const value = { register_number: r.register_number, l1: r.l1, l2: r.l2, l3: r.l3 }
    if (r.fund_name) out.set(r.fund_name, value)
    if (r.fund_short_name) out.set(r.fund_short_name, value)
    if (r.register_number) out.set(r.register_number, value)
  }
  return out
}

export async function getFofReturnAttribution(
  rawBeianHao: string,
  fromDate: string,
  toDate: string,
): Promise<FofAttributionResult> {
  const from = fromDate.slice(0, 10)
  const to = toDate.slice(0, 10)
  const empty: FofAttributionResult = {
    fromDate: from,
    toDate: to,
    snapshotFrom: null,
    snapshotTo: null,
    earliestValuationDate: null,
    startNav: null,
    startPaidIn: null,
    rows: [],
    totalPnl: 0,
    totalReturnContribution: 0,
    totalNavContribution: 0,
  }
  if (!from || !to || from > to) return empty

  const { product_name, candidateCodes } = await resolveCandidateCodes(rawBeianHao)
  await ensureEmailValuationTable()
  await ensureEmailValuationHoldingsTables()

  const [inRange, earliestRows] = await Promise.all([
    query<RecordRow>(
      `SELECT DISTINCT ON (valuation_date)
         id,
         valuation_date::text AS valuation_date,
         net_asset_value::text AS net_asset_value,
         paid_in_capital::text AS paid_in_capital,
         unit_nav::text AS unit_nav
       FROM ops_email_valuation_records
       WHERE product_code = ANY($1::text[])
         AND valuation_date >= $2::date
         AND valuation_date <= $3::date
       ORDER BY valuation_date ASC, id DESC`,
      [candidateCodes, from, to],
    ),
    query<{ d: string | null }>(
      `SELECT MIN(valuation_date)::text AS d
       FROM ops_email_valuation_records
       WHERE product_code = ANY($1::text[])`,
      [candidateCodes],
    ),
  ])
  const earliestValuationDate = earliestRows[0]?.d?.slice(0, 10) ?? null

  const firstInRange = inRange[0]
  const needPrior = !firstInRange || firstInRange.valuation_date.slice(0, 10) > from
  const prior = needPrior
    ? await query<RecordRow>(
      `SELECT
         id,
         valuation_date::text AS valuation_date,
         net_asset_value::text AS net_asset_value,
         paid_in_capital::text AS paid_in_capital,
         unit_nav::text AS unit_nav
       FROM ops_email_valuation_records
       WHERE product_code = ANY($1::text[])
         AND valuation_date < $2::date
       ORDER BY valuation_date DESC, id DESC
       LIMIT 1`,
      [candidateCodes, from],
    )
    : []

  let records = prior[0] ? [prior[0], ...inRange] : inRange

  if (records.length === 0 && product_name) {
    records = await query<RecordRow>(
      `SELECT DISTINCT ON (valuation_date)
         id,
         valuation_date::text AS valuation_date,
         net_asset_value::text AS net_asset_value,
         paid_in_capital::text AS paid_in_capital,
         unit_nav::text AS unit_nav
       FROM ops_email_valuation_records
       WHERE fund_name = $1
         AND valuation_date >= $2::date
         AND valuation_date <= $3::date
       ORDER BY valuation_date ASC, id DESC`,
      [product_name, from, to],
    )
  }

  if (records.length === 0) return { ...empty, earliestValuationDate }

  const recordIds = records.map((r) => parseInt(r.id, 10)).filter((id) => Number.isFinite(id))
  const holdingRows = recordIds.length > 0
    ? await query<HoldingSqlRow>(
      `SELECT
         valuation_record_id::text,
         subject_name,
         symbol,
         subject_code,
         original_subject_code,
         row_kind,
         quantity::text,
         price::text,
         market_value::text,
         signed_market_value::text,
         cost::text,
         signed_cost::text,
         is_leaf,
         include_in_detail
       FROM ops_email_valuation_holdings
       WHERE valuation_record_id = ANY($1::bigint[])
         AND (
           row_kind IN ('private_fund', 'fund', 'money_fund', 'fund_or_stock')
           OR subject_code ~ '^(1109|1108)'
           OR COALESCE(subject_name, '') ~ '私募'
         )`,
      [recordIds],
    )
    : []

  const holdingsByRecord = new Map<number, HoldingSqlRow[]>()
  for (const row of holdingRows) {
    const id = parseInt(row.valuation_record_id, 10)
    const list = holdingsByRecord.get(id)
    if (list) list.push(row)
    else holdingsByRecord.set(id, [row])
  }

  const snapshots: Array<{
    date: string
    nav: number
    paidIn: number
    positions: Map<string, Position>
  }> = []

  for (const record of records) {
    const id = parseInt(record.id, 10)
    const rawHoldings = holdingsByRecord.get(id) ?? []
    const merged = mergeSameProductFundHoldings(rawHoldings.filter(isFundHoldingMergeCandidate))
    const positions = new Map<string, Position>()
    for (const row of merged) {
      const pos = toPosition(row)
      if (!pos) continue
      const existing = positions.get(pos.key)
      if (!existing || Math.abs(pos.mv) > Math.abs(existing.mv)) positions.set(pos.key, pos)
    }
    if (positions.size === 0) continue
    snapshots.push({
      date: record.valuation_date.slice(0, 10),
      nav: parseNum(record.net_asset_value),
      paidIn: parseNum(record.paid_in_capital),
      positions,
    })
  }

  if (snapshots.length === 0) return { ...empty, earliestValuationDate }

  const onOrBeforeFrom = snapshots.filter((s) => s.date <= from)
  const start = onOrBeforeFrom.length > 0 ? onOrBeforeFrom[onOrBeforeFrom.length - 1] : snapshots[0]
  const rest = snapshots.filter((s) => s.date > start.date && s.date <= to)
  const window = [start, ...rest]
  if (window.length < 2) {
    return {
      ...empty,
      earliestValuationDate,
      snapshotFrom: window[0]?.date ?? null,
      snapshotTo: window[0]?.date ?? null,
    }
  }

  const end = window[window.length - 1]
  const acc = new Map<string, FundAcc>()

  for (let i = 1; i < window.length; i++) {
    const prev = window[i - 1]
    const curr = window[i]
    const keys = new Set([...prev.positions.keys(), ...curr.positions.keys()])
    for (const key of keys) {
      const prevPos = prev.positions.get(key)
      const currPos = curr.positions.get(key)
      const pnl = dayPnl(prevPos, currPos)
      if (!Number.isFinite(pnl)) continue
      const sample = currPos ?? prevPos
      const cur = acc.get(key) ?? {
        fundName: sample?.fundName ?? key,
        valuationCode: sample?.valuationCode ?? null,
        pnl: 0,
      }
      cur.pnl += pnl
      if (sample?.fundName) cur.fundName = sample.fundName
      if (sample?.valuationCode) cur.valuationCode = sample.valuationCode
      acc.set(key, cur)
    }
  }

  const startNav = start.nav > 0
    ? start.nav
    : [...start.positions.values()].reduce((s, p) => s + Math.abs(p.mv), 0)
  const startPaidIn = start.paidIn > 0
    ? start.paidIn
    : startNav
  const returnBase = startNav > 0 ? startNav : 0
  const navBase = startPaidIn > 0 ? startPaidIn : returnBase

  const beianCodes = [...acc.values()].map((r) => r.valuationCode).filter((v): v is string => Boolean(v))
  const strategyMap = await loadCompanyStrategyBatch(beianCodes, [...acc.values()].map((r) => r.fundName))

  const rows: FofAttributionRow[] = [...acc.values()]
    .map((item) => {
      const stripped = item.fundName.replace(/私募证券投资基金/g, "").replace(/私募基金/g, "").trim()
      const strategyRow =
        (item.valuationCode ? strategyMap.get(item.valuationCode) : null)
        ?? strategyMap.get(item.fundName)
        ?? strategyMap.get(stripped)
      const pnl = item.pnl
      const code = item.valuationCode || strategyRow?.register_number || null
      return {
        fundName: item.fundName,
        beianHao: code,
        valuationCode: code,
        strategy: strategyRow?.l1?.trim() || null,
        strategyL2: strategyRow?.l2?.trim() || null,
        strategyL3: strategyRow?.l3?.trim() || null,
        fromDate: start.date,
        toDate: end.date,
        pnl,
        returnContribution: returnBase > 0 ? pnl / returnBase : 0,
        navContribution: navBase > 0 ? pnl / navBase : 0,
      }
    })
    .filter((row) => Math.abs(row.pnl) >= 0.005 || Math.abs(row.returnContribution) >= 1e-8)
    .sort((a, b) => a.pnl - b.pnl)

  const totalPnl = rows.reduce((s, r) => s + r.pnl, 0)
  return {
    fromDate: from,
    toDate: to,
    snapshotFrom: start.date,
    snapshotTo: end.date,
    earliestValuationDate,
    startNav: returnBase > 0 ? returnBase : null,
    startPaidIn: navBase > 0 ? navBase : null,
    rows,
    totalPnl,
    totalReturnContribution: returnBase > 0 ? totalPnl / returnBase : 0,
    totalNavContribution: navBase > 0 ? totalPnl / navBase : 0,
  }
}
