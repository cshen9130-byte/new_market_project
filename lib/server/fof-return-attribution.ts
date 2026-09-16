/**
 * FOF 基金持仓收益归因：
 * 区间投资收益 = 剩余持仓市值变动 + Σ申赎已实现盈亏。
 * 申赎优先用运维「申赎台账」确认份额/净额/净值；台账无记录时用估值表份额变动
 * × 期末净值估算申赎市值。不含股票、期货等非基金资产。
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
import { listServerOpsLedgerRecords, type OpsLedgerRow } from "@/lib/server/ops-ledger-records"
import { beianFamilyKey } from "@/lib/server/share-class-product"
import {
  applyValuationHoldingDisplayName,
  isValuationNonProductHoldingName,
} from "@/lib/valuation-holding-display-name"
import {
  computeHoldingStepPnl,
  inferFlowEventsFromQty,
  type AttributionFlowEvent,
} from "@/lib/server/fof-holding-step-pnl"

/** Same floor as 申赎台账 generation (`MIN_ABS_AMOUNT`). */
const MIN_ABS_CASHFLOW = 100

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
  mtmPnl: number
  realizedPnl: number
  returnContribution: number
  navContribution: number
  cashFlow: number
  cashFlowSource: "ledger" | "qty" | "none"
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
  matchKeys: string[]
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
  mtmPnl: number
  realizedPnl: number
  cashFlow: number
  ledgerHits: number
  qtyHits: number
}

function parseNum(value: string | number | null | undefined): number {
  if (value == null || value === "") return 0
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").trim())
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

function stripFundName(name: string): string {
  return name.replace(/私募证券投资基金/g, "").replace(/私募基金/g, "").replace(/\s+/g, "").trim()
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

function positionMatchKeys(ident: { fundName: string; valuationCode: string | null }): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  const add = (key: string) => {
    if (!key || seen.has(key)) return
    seen.add(key)
    keys.push(key)
  }
  if (ident.valuationCode) {
    const code = ident.valuationCode.trim().toUpperCase()
    add(`code:${code}`)
    const family = beianFamilyKey(code)
    if (family) add(`code:${family}`)
  }
  if (ident.fundName) {
    add(`name:${ident.fundName}`)
    const stripped = stripFundName(ident.fundName)
    if (stripped) add(`name:${stripped}`)
  }
  return keys
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
    matchKeys: positionMatchKeys(ident),
    fundName: ident.fundName,
    valuationCode: ident.valuationCode,
    qty,
    price,
    mv,
    cost,
  }
}

function isParentFofLedgerRow(
  row: OpsLedgerRow,
  candidateCodes: string[],
  productName: string | null,
): boolean {
  const codeSet = new Set(candidateCodes.map((c) => c.trim().toUpperCase()).filter(Boolean))
  const famSet = new Set(
    [...codeSet].map((c) => beianFamilyKey(c)).filter((v): v is string => Boolean(v)),
  )
  const fofCode = (row.fof_register_number || "").trim().toUpperCase()
  if (fofCode) {
    if (codeSet.has(fofCode)) return true
    const fam = beianFamilyKey(fofCode)
    if (fam && famSet.has(fam)) return true
  }
  if (!productName) return false
  const pn = productName.replace(/\s+/g, "")
  const fn = row.fof_fund_name.replace(/\s+/g, "")
  if (fn && pn && (fn.includes(pn) || pn.includes(fn))) return true
  const a = stripFundName(fn)
  const b = stripFundName(pn)
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)))
}

function ledgerRowMatchKeys(row: OpsLedgerRow): string[] {
  const display = applyValuationHoldingDisplayName(
    row.underlying_fund_name,
    row.underlying_beian_hao,
  ) || row.underlying_fund_name
  return positionMatchKeys({
    fundName: display,
    valuationCode: row.underlying_beian_hao,
  })
}

function signedLedgerAmount(row: OpsLedgerRow): number {
  const raw = parseNum(row.confirmed_amount)
  if (!Number.isFinite(raw) || raw === 0) return 0
  const abs = Math.abs(raw)
  const t = String(row.transaction_type ?? "").replace(/\s+/g, "")
  if (/赎回|转换出|强制调减|现金分红/.test(t) && !/申购|认购|转换入/.test(t)) return -abs
  if (/申购|认购|转换入|强制调增|红利/.test(t)) return abs
  return raw
}

function indexLedgerByMatchKey(rows: OpsLedgerRow[]): Map<string, OpsLedgerRow[]> {
  const map = new Map<string, OpsLedgerRow[]>()
  for (const row of rows) {
    for (const key of ledgerRowMatchKeys(row)) {
      const list = map.get(key)
      if (list) {
        if (!list.some((existing) => existing.id === row.id)) list.push(row)
      } else {
        map.set(key, [row])
      }
    }
  }
  return map
}

function ledgerRowsForPosition(
  index: Map<string, OpsLedgerRow[]>,
  pos: Position | undefined,
  other: Position | undefined,
): OpsLedgerRow[] {
  const sample = pos ?? other
  if (!sample) return []
  const seen = new Set<string>()
  const out: OpsLedgerRow[] = []
  const collect = (keys: string[]) => {
    for (const key of keys) {
      for (const row of index.get(key) ?? []) {
        if (seen.has(row.id)) continue
        seen.add(row.id)
        out.push(row)
      }
    }
  }
  const exactCode = sample.valuationCode?.trim().toUpperCase() || ""
  const exactKeys = exactCode ? [`code:${exactCode}`] : []
  const familyKeys = sample.matchKeys.filter((k) => k.startsWith("code:") && k !== `code:${exactCode}`)
  const nameKeys = sample.matchKeys.filter((k) => k.startsWith("name:"))
  collect(exactKeys)
  if (out.length > 0) return out
  collect(familyKeys)
  if (out.length > 0) return out
  collect(nameKeys)
  return out
}

function ledgerFlowKind(row: OpsLedgerRow): AttributionFlowEvent["kind"] | null {
  const t = String(row.transaction_type ?? "").replace(/\s+/g, "")
  if (/现金分红/.test(t)) return "dividend"
  if (/赎回|转换出|强制调减/.test(t) && !/申购|认购|转换入/.test(t)) return "redeem"
  if (/申购|认购|转换入|强制调增|红利/.test(t)) return "subscribe"
  const signed = signedLedgerAmount(row)
  if (signed < 0) return "redeem"
  if (signed > 0) return "subscribe"
  return null
}

function ledgerEventsInStep(
  rows: OpsLedgerRow[],
  prevDate: string,
  currDate: string,
  usedIds: Set<string>,
): AttributionFlowEvent[] {
  const out: AttributionFlowEvent[] = []
  for (const row of rows) {
    const d = row.confirm_date.slice(0, 10)
    if (!d || d <= prevDate || d > currDate) continue
    if (usedIds.has(row.id)) continue
    const kind = ledgerFlowKind(row)
    if (!kind) continue
    const amount = Math.abs(parseNum(row.confirmed_amount))
    const shares = Math.abs(parseNum(row.confirmed_shares))
    const navRaw = parseNum(row.confirmed_unit_nav)
    const nav = navRaw > 0 ? navRaw : (shares > 0 && amount > 0 ? amount / shares : null)
    const resolvedAmount = amount > 0 ? amount : (finiteNav(nav) && shares > 0 ? shares * nav : 0)
    if (resolvedAmount < MIN_ABS_CASHFLOW && shares < 0.01) continue
    usedIds.add(row.id)
    out.push({
      date: d,
      kind,
      shares,
      amount: resolvedAmount,
      nav: finiteNav(nav) ? nav : null,
    })
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind))
  return out
}

function finiteNav(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n) && n > 0
}

function cashFlowSourceOf(acc: FundAcc): "ledger" | "qty" | "none" {
  if (acc.ledgerHits > 0) return "ledger"
  if (acc.qtyHits > 0) return "qty"
  return "none"
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

  const [inRange, earliestRows, allLedger] = await Promise.all([
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
    listServerOpsLedgerRecords(),
  ])
  const earliestValuationDate = earliestRows[0]?.d?.slice(0, 10) ?? null
  const parentLedger = allLedger.filter((row) => isParentFofLedgerRow(row, candidateCodes, product_name))
  const ledgerIndex = indexLedgerByMatchKey(parentLedger)

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
  const usedLedgerIds = new Set<string>()

  for (let i = 1; i < window.length; i++) {
    const prev = window[i - 1]
    const curr = window[i]
    const keys = [...new Set([...prev.positions.keys(), ...curr.positions.keys()])]
    keys.sort((a, b) => {
      const aCoded = (prev.positions.get(a) ?? curr.positions.get(a))?.valuationCode ? 0 : 1
      const bCoded = (prev.positions.get(b) ?? curr.positions.get(b))?.valuationCode ? 0 : 1
      return aCoded - bCoded
    })
    for (const key of keys) {
      const prevPos = prev.positions.get(key)
      const currPos = curr.positions.get(key)
      const ledgerRows = ledgerRowsForPosition(ledgerIndex, currPos, prevPos)
      const usedBefore = usedLedgerIds.size
      const ledgerEvents = ledgerEventsInStep(ledgerRows, prev.date, curr.date, usedLedgerIds)
      const usedLedger = usedLedgerIds.size > usedBefore

      let events = ledgerEvents
      let usedQty = false
      if (events.length === 0) {
        const inferred = inferFlowEventsFromQty(prevPos, currPos)
        if (inferred.length > 0) {
          events = inferred
          usedQty = true
        }
      }

      const step = computeHoldingStepPnl(prevPos, currPos, events)
      if (!Number.isFinite(step.pnl)) continue

      const sample = currPos ?? prevPos
      const cur = acc.get(key) ?? {
        fundName: sample?.fundName ?? key,
        valuationCode: sample?.valuationCode ?? null,
        pnl: 0,
        mtmPnl: 0,
        realizedPnl: 0,
        cashFlow: 0,
        ledgerHits: 0,
        qtyHits: 0,
      }
      cur.pnl += step.pnl
      cur.mtmPnl += step.mtmPnl
      cur.realizedPnl += step.realizedPnl
      cur.cashFlow += step.cashFlow
      if (usedLedger) cur.ledgerHits += 1
      if (usedQty) cur.qtyHits += 1
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
        mtmPnl: item.mtmPnl,
        realizedPnl: item.realizedPnl,
        cashFlow: item.cashFlow,
        cashFlowSource: cashFlowSourceOf(item),
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
