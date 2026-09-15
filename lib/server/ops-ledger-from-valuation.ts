/**
 * First-pass FOF底层 申赎台账 from parent-FOF 估值表 share changes,
 * with optional overlay from parsed 交易确认单.
 *
 * Rules: docs/ops-ledger-generation-rules.md
 * 确认单 wins. Else 申请日=T, 确认日=T+1, 净值=T行情, 净额=Δ成本 (prefer integer).
 * Manual / locked / confirmed / instruction rows are never overwritten.
 */

import { query, queryUnbounded } from "@/lib/db"
import { ensureEmailConfirmTable } from "@/lib/server/email-confirm-pg"
import { ensureEmailValuationHoldingsTables } from "@/lib/server/email-valuation-holdings-pg"
import {
  SQL_VALUATION_HOLDING_IS_DIRECT_EQUITY_OR_ETF,
  sqlSubjectCodeIsClearing,
  sqlSubjectCodeIsValuationIncrement,
} from "@/lib/server/fund-holding-code"
import {
  isProtectedLedgerRow,
  listServerOpsLedgerRecords,
  listLedgerGenerationSkips,
  upsertServerOpsLedgerRecords,
  type OpsLedgerRow,
} from "@/lib/server/ops-ledger-records"
import {
  beianFamilyKey,
  sqlBeianFamilyKey,
} from "@/lib/server/share-class-product"
import { stripValuationSubjectPathPrefix } from "@/lib/valuation-holding-display-name"

export const AUTO_LEDGER_SOURCE = "估值表"
export const AUTO_LEDGER_CONFIRM_SOURCE = "估值表+确认单"

const MIN_ABS_SHARES = 0.5
const MIN_ABS_AMOUNT = 100
const CONFIRM_DATE_WINDOW_DAYS = 7
const CONFIRM_SHARE_TOLERANCE = 0.1

const HOLDING_FILTER_SQL = `
  h.include_in_detail = TRUE
    AND COALESCE(h.market_value, h.cost, 0) > 0
    AND h.row_kind NOT IN (
      'bank_deposit', 'receivable', 'payable', 'settlement_reserve',
      'margin_deposit', 'clearing', 'derivative', 'stock', 'bond', 'repo'
    )
    AND NOT ${sqlSubjectCodeIsClearing("h.subject_code")}
    AND NOT ${sqlSubjectCodeIsValuationIncrement("h.subject_code")}
    AND NULLIF(BTRIM(h.symbol), '') IS NOT NULL
    AND BTRIM(h.symbol) ~ '^[A-Za-z0-9]+$'
    AND NOT ${SQL_VALUATION_HOLDING_IS_DIRECT_EQUITY_OR_ETF}
    AND (
      h.row_kind IN ('private_fund', 'fund_or_stock', 'fund', 'money_fund')
      OR h.subject_code LIKE '1109%'
      OR h.subject_code LIKE '1108%'
      OR h.subject_name ~ '私募证券投资基金'
      OR h.subject_name ~ '私募基金'
      OR (h.row_kind = 'other' AND NULLIF(BTRIM(h.symbol), '') IS NOT NULL)
    )`

export type ValuationLedgerDelta = {
  parentCode: string
  parentName: string
  parentKey: string
  underlyingCode: string
  underlyingName: string
  /** Quantity-jump date (T+1 / 确认日). Used in generation_key. */
  valuationDate: string
  /** Previous valuation date (T / 申请日). Same as valuationDate on first appearance. */
  applyDate: string
  prevQty: number
  qty: number
  deltaQty: number
  /** 行情 on T (申请日). */
  prevNav: number | null
  /** 行情 on T+1. Do not use for 确认净额 / 确认单位净值. */
  nav: number | null
  prevCost: number | null
  cost: number | null
  deltaCost: number | null
  firstAppearance: boolean
}

export type ConfirmOverlayInput = {
  id: number
  fundCode: string | null
  fundName: string | null
  investorName: string | null
  applyDate: string | null
  confirmDate: string | null
  businessType: string | null
  confirmedAmount: number | null
  confirmedShares: number | null
  unitNav: number | null
  tradeFee: number | null
  attachmentFilename: string | null
}

export function normalizeLedgerBusinessType(
  raw: string | null | undefined,
  deltaSign: number,
): string {
  const s = String(raw ?? "").replace(/\s+/g, "")
  if (/业绩报酬|份额调减|强制调减/.test(s) && !/调增/.test(s)) return "强制调减"
  if (/强制调增/.test(s)) return "强制调增"
  if (/红利再投|红利转/.test(s)) return "红利转份额"
  if (/现金分红/.test(s)) return "现金分红"
  if (/转换入/.test(s)) return "转换入"
  if (/转换出/.test(s)) return "转换出"
  if (/认购/.test(s)) return "认购"
  if (/赎回/.test(s) && !/申购/.test(s)) return "赎回"
  if (/申购/.test(s)) return "申购"
  return deltaSign < 0 ? "赎回" : "申购"
}

export function isMeaningfulShareDelta(deltaQty: number, nav: number | null): boolean {
  const absQty = Math.abs(deltaQty)
  if (!(absQty >= MIN_ABS_SHARES)) return false
  if (nav != null && Number.isFinite(nav) && nav > 0 && absQty * nav < MIN_ABS_AMOUNT) {
    return false
  }
  return true
}

export function valuationLedgerGenerationKey(
  parentCode: string,
  underlyingCode: string,
  date: string,
): string {
  const parent = (beianFamilyKey(parentCode) || parentCode || "NA").replace(/[^A-Za-z0-9]/g, "")
  const und = (beianFamilyKey(underlyingCode) || underlyingCode || "NA").replace(/[^A-Za-z0-9]/g, "")
  return `val-${parent}-${und}-${date}`
}

function parseNum(value: unknown): number | null {
  if (value == null || value === "") return null
  const n = Number(String(value).replace(/,/g, "").trim())
  return Number.isFinite(n) ? n : null
}

function fmtQty(n: number): string {
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

function fmtAmt(n: number): string {
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtNav(n: number): string {
  return n.toFixed(4)
}

function addNullable(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null
  return (a ?? 0) + (b ?? 0)
}

/** Managers subscribe/redeem in round lots. Prefer 1,000,000.00 over 1,010,831.62. */
export function preferIntegerAmount(candidates: Array<number | null | undefined>): number | null {
  const nums = candidates.filter(
    (n): n is number => n != null && Number.isFinite(n) && Math.abs(n) >= MIN_ABS_AMOUNT,
  )
  if (nums.length === 0) return null
  const abs = (n: number) => Math.abs(n)
  const isNearInteger = (n: number) => Math.abs(n - Math.round(n)) < 0.02
  const integers = nums.filter(isNearInteger)
  const pool = integers.length > 0 ? integers : nums
  const roundness = (n: number) => {
    const a = Math.round(abs(n))
    if (a % 1_000_000 === 0) return 5
    if (a % 100_000 === 0) return 4
    if (a % 10_000 === 0) return 3
    if (a % 1_000 === 0) return 2
    if (a % 100 === 0) return 1
    return 0
  }
  pool.sort((a, b) => roundness(b) - roundness(a) || abs(a) - abs(b))
  return pool[0]
}

export function resolveValuationLedgerAmount(delta: ValuationLedgerDelta): number | null {
  const absDelta = Math.abs(delta.deltaQty)
  const fromCost = delta.deltaCost
  const fromApplyNav =
    delta.prevNav != null && delta.prevNav > 0 ? absDelta * delta.prevNav : null
  return preferIntegerAmount([fromCost, fromApplyNav])
}

function daysBetween(a: string, b: string): number {
  const da = Date.parse(a)
  const db = Date.parse(b)
  if (!Number.isFinite(da) || !Number.isFinite(db)) return Number.POSITIVE_INFINITY
  return Math.abs(da - db) / 86_400_000
}

function resolveNav(price: unknown, qty: number, mv: number | null): number | null {
  const p = parseNum(price)
  if (p != null && p > 0.05 && p < 500) return p
  if (qty > 0 && mv != null && mv > 0) {
    const nav = mv / qty
    if (nav >= 0.1 && nav <= 100) return nav
  }
  return null
}

export function matchConfirmToDelta(
  delta: ValuationLedgerDelta,
  confirms: ConfirmOverlayInput[],
  usedIds: Set<number>,
): ConfirmOverlayInput | null {
  const undFamily = beianFamilyKey(delta.underlyingCode)
  const parentFamily = beianFamilyKey(delta.parentCode)
  const absDelta = Math.abs(delta.deltaQty)
  let best: { row: ConfirmOverlayInput; score: number } | null = null

  for (const row of confirms) {
    if (usedIds.has(row.id)) continue
    const hasShares = row.confirmedShares != null && Math.abs(row.confirmedShares) > 0
    const hasAmount = row.confirmedAmount != null && Math.abs(row.confirmedAmount) > 0
    if (!hasShares && !hasAmount) continue
    const codeFamily = beianFamilyKey(row.fundCode)
    const codeOk =
      (codeFamily && undFamily && codeFamily === undFamily)
      || (row.fundCode && row.fundCode.toUpperCase() === delta.underlyingCode.toUpperCase())
    const nameOk = Boolean(
      row.fundName
      && delta.underlyingName
      && row.fundName.replace(/\s+/g, "").includes(delta.underlyingName.replace(/\s+/g, "").slice(0, 6)),
    )
    if (!codeOk && !nameOk) continue

    const eventDate = row.confirmDate || row.applyDate
    if (!eventDate) continue
    const confirmDayDist = daysBetween(eventDate, delta.valuationDate)
    const applyDayDist = row.applyDate
      ? daysBetween(row.applyDate, delta.applyDate)
      : Number.POSITIVE_INFINITY
    const dateDist = Math.min(confirmDayDist, applyDayDist)
    if (dateDist > CONFIRM_DATE_WINDOW_DAYS) continue

    const shareDist =
      row.confirmedShares != null && Math.abs(row.confirmedShares) > 0
        ? Math.abs(Math.abs(row.confirmedShares) - absDelta) / Math.max(absDelta, Math.abs(row.confirmedShares), 1)
        : Number.POSITIVE_INFINITY
    const amountAbs = row.confirmedAmount != null ? Math.abs(row.confirmedAmount) : null
    const costAbs = delta.deltaCost != null ? Math.abs(delta.deltaCost) : null
    const amountDist =
      amountAbs != null && costAbs != null && Math.max(amountAbs, costAbs) > 0
        ? Math.abs(amountAbs - costAbs) / Math.max(amountAbs, costAbs)
        : Number.POSITIVE_INFINITY
    if (shareDist > CONFIRM_SHARE_TOLERANCE && amountDist > CONFIRM_SHARE_TOLERANCE) continue

    const sign = delta.deltaQty < 0 ? -1 : 1
    const confirmType = normalizeLedgerBusinessType(row.businessType, sign)
    if (sign < 0 && confirmType === "申购") continue
    if (sign > 0 && confirmType === "赎回") continue

    const investor = (row.investorName || "").replace(/\s+/g, "")
    const parentHit = Boolean(
      (parentFamily && investor && investor.toUpperCase().includes(parentFamily))
      || (delta.parentName && investor && investor.includes(delta.parentName.replace(/\s+/g, "").slice(0, 4))),
    )
    const score =
      dateDist * 10
      + (Number.isFinite(shareDist) ? shareDist * 20 : 8)
      + (Number.isFinite(amountDist) ? amountDist * 10 : 0)
      - (parentHit ? 2 : 0)
      - (codeOk ? 1 : 0)
    if (!best || score < best.score) best = { row, score }
  }
  return best?.row ?? null
}

export function buildValuationLedgerRow(
  delta: ValuationLedgerDelta,
  confirm: ConfirmOverlayInput | null,
): OpsLedgerRow {
  const sign = delta.deltaQty < 0 ? -1 : 1
  const absDelta = Math.abs(delta.deltaQty)
  const nav = confirm?.unitNav ?? delta.prevNav ?? delta.nav
  const amount = confirm?.confirmedAmount ?? resolveValuationLedgerAmount(delta)
  const txType = normalizeLedgerBusinessType(confirm?.businessType, sign)
  const source = confirm ? AUTO_LEDGER_CONFIRM_SOURCE : AUTO_LEDGER_SOURCE
  const remarks: string[] = []
  if (delta.firstAppearance) remarks.push("估值表首现持仓，申请日可能早于该估值日")
  if (!confirm) remarks.push("由估值表数量/成本变动估算，申请日=上一估值日，净值用申请日行情")
  else remarks.push(`已匹配交易确认单#${confirm.id}`)

  return {
    id: valuationLedgerGenerationKey(delta.parentKey, delta.underlyingCode, delta.valuationDate),
    fof_fund_name: delta.parentName,
    fof_register_number: delta.parentCode || null,
    transaction_type: txType,
    underlying_type: "FOF底层",
    underlying_fund_name: delta.underlyingName,
    underlying_beian_hao: delta.underlyingCode || null,
    apply_date: confirm?.applyDate || confirm?.confirmDate || delta.applyDate,
    confirm_date: confirm?.confirmDate || confirm?.applyDate || delta.valuationDate,
    confirmed_shares: fmtQty(confirm?.confirmedShares != null ? Math.abs(confirm.confirmedShares) : absDelta),
    confirmed_amount: amount != null ? fmtAmt(Math.abs(amount)) : null,
    confirmed_unit_nav: nav != null ? fmtNav(nav) : null,
    transaction_fee: confirm?.tradeFee != null ? fmtAmt(Math.abs(confirm.tradeFee)) : null,
    performance_fee: txType === "强制调减" && amount != null ? fmtAmt(Math.abs(amount)) : null,
    share_balance: fmtQty(delta.qty),
    dividend_per_unit: null,
    source,
    remark: remarks.join("；"),
    instruction_id: null,
    contract_attachment: null,
    confirm_attachment: confirm
      ? {
          id: `email-confirm:${confirm.id}`,
          name: confirm.attachmentFilename || `确认单#${confirm.id}`,
          source: "email",
          confirmRecordId: confirm.id,
        }
      : null,
    generation_key: valuationLedgerGenerationKey(delta.parentKey, delta.underlyingCode, delta.valuationDate),
    locked: false,
    review_status: "pending",
    reviewed_by: null,
    reviewed_at: null,
  }
}

type HeldProduct = {
  beian_hao: string
  product_name: string
  family: string
}

type SeriesRow = {
  parent_code: string | null
  parent_name: string | null
  und_code: string
  und_name: string | null
  valuation_date: string
  qty: string | null
  mv: string | null
  price: string | null
  cost: string | null
}

function pickHeld(symbol: string, held: HeldProduct[]): HeldProduct | null {
  const upper = symbol.toUpperCase()
  const exact = held.find((h) => h.beian_hao === upper)
  if (exact) return exact
  const family = beianFamilyKey(symbol)
  if (!family) return null
  return held.find((h) => h.family === family) ?? null
}

function mapParent(
  code: string,
  name: string,
  tracking: Array<{ register_number: string; product_name: string }>,
): { code: string; name: string } {
  const family = beianFamilyKey(code)
  const hit = tracking.find((t) => {
    const tf = beianFamilyKey(t.register_number)
    return (tf && family && tf === family) || t.register_number.toUpperCase() === code.toUpperCase()
  })
  return {
    code: hit?.register_number || code,
    name: hit?.product_name || name || hit?.register_number || code,
  }
}

export type GenerateValuationLedgerResult = {
  products: number
  candidates: number
  inserted: number
  updated: number
  skippedProtected: number
  skippedDeleted: number
  confirmMatched: number
}

export async function generateFofUnderlyingLedgerFromValuation(): Promise<GenerateValuationLedgerResult> {
  await ensureEmailValuationHoldingsTables()
  await ensureEmailConfirmTable()

  const heldRows = await query<{ beian_hao: string; product_name: string }>(
    `SELECT beian_hao, product_name
       FROM ops_fof_overview_list_cache
      WHERE COALESCE(market_value, 0) > 0
        AND NULLIF(BTRIM(beian_hao), '') IS NOT NULL`,
  )
  const held: HeldProduct[] = []
  const seenHeld = new Set<string>()
  for (const row of heldRows) {
    const beian = String(row.beian_hao || "").trim().toUpperCase()
    if (!beian || seenHeld.has(beian)) continue
    const family = beianFamilyKey(beian) || beian
    seenHeld.add(beian)
    held.push({ beian_hao: beian, product_name: row.product_name, family })
  }

  const empty: GenerateValuationLedgerResult = {
    products: held.length,
    candidates: 0,
    inserted: 0,
    updated: 0,
    skippedProtected: 0,
    skippedDeleted: 0,
    confirmMatched: 0,
  }
  if (held.length === 0) return empty

  const tracking = await query<{ register_number: string; product_name: string }>(
    `SELECT register_number, product_name FROM fof_mom_tracking
      WHERE NULLIF(BTRIM(register_number), '') IS NOT NULL`,
  ).catch(() => [] as Array<{ register_number: string; product_name: string }>)

  const series = await queryUnbounded<SeriesRow>(
    `SELECT
       NULLIF(BTRIM(r.product_code), '') AS parent_code,
       NULLIF(BTRIM(r.fund_name), '') AS parent_name,
       UPPER(BTRIM(h.symbol)) AS und_code,
       MAX(h.subject_name) AS und_name,
       r.valuation_date::text AS valuation_date,
       SUM(h.quantity)::text AS qty,
       SUM(h.market_value)::text AS mv,
       MAX(h.price)::text AS price,
       SUM(h.cost)::text AS cost
     FROM ops_email_valuation_holdings h
     INNER JOIN ops_email_valuation_records r ON r.id = h.valuation_record_id
     INNER JOIN (
       SELECT DISTINCT ${sqlBeianFamilyKey("beian_hao")} AS family
         FROM ops_fof_overview_list_cache
        WHERE COALESCE(market_value, 0) > 0
          AND NULLIF(BTRIM(beian_hao), '') IS NOT NULL
     ) held ON ${sqlBeianFamilyKey("h.symbol")} = held.family
     WHERE ${HOLDING_FILTER_SQL}
     GROUP BY r.product_code, r.fund_name, UPPER(BTRIM(h.symbol)), r.valuation_date
     ORDER BY 1, 3, 5`,
  )

  const confirmRows = await query<{
    id: string
    fund_name: string | null
    fund_code: string | null
    investor_name: string | null
    apply_date: string | null
    confirm_date: string | null
    business_type: string | null
    confirmed_amount: string | null
    confirmed_shares: string | null
    unit_nav: string | null
    trade_fee: string | null
    attachment_filename: string | null
  }>(
    `SELECT id::text,
            fund_name, fund_code, investor_name,
            apply_date::text, confirm_date::text, business_type,
            confirmed_amount::text, confirmed_shares::text, unit_nav::text,
            trade_fee::text, attachment_filename
       FROM ops_email_confirm_records
      WHERE confirmed_shares IS NOT NULL
         OR confirmed_amount IS NOT NULL`,
  )
  const confirms: ConfirmOverlayInput[] = confirmRows.map((row) => ({
    id: Number(row.id),
    fundCode: row.fund_code,
    fundName: row.fund_name,
    investorName: row.investor_name,
    applyDate: row.apply_date,
    confirmDate: row.confirm_date,
    businessType: row.business_type,
    confirmedAmount: parseNum(row.confirmed_amount),
    confirmedShares: parseNum(row.confirmed_shares),
    unitNav: parseNum(row.unit_nav),
    tradeFee: parseNum(row.trade_fee),
    attachmentFilename: row.attachment_filename,
  }))

  type Point = {
    date: string
    qty: number
    mv: number | null
    price: unknown
    cost: number | null
    undName: string
  }
  const grouped = new Map<string, {
    parentCode: string
    parentName: string
    parentKey: string
    und: HeldProduct
    points: Point[]
  }>()

  for (const row of series) {
    const und = pickHeld(row.und_code, held)
    if (!und) continue
    const rawParent = String(row.parent_code || "").trim().toUpperCase()
    const rawParentName = String(row.parent_name || "").trim()
    if (!rawParent && !rawParentName) continue
    const parent = mapParent(rawParent, rawParentName, tracking)
    const parentKey = beianFamilyKey(parent.code) || parent.code || parent.name
    const key = `${parentKey}::${und.beian_hao}`
    let bucket = grouped.get(key)
    if (!bucket) {
      bucket = { parentCode: parent.code, parentName: parent.name, parentKey, und, points: [] }
      grouped.set(key, bucket)
    }
    const qty = parseNum(row.qty) ?? 0
    const mv = parseNum(row.mv)
    const cost = parseNum(row.cost)
    const date = String(row.valuation_date || "").slice(0, 10)
    if (!date) continue
    const displayName = und.product_name || stripValuationSubjectPathPrefix(row.und_name || "") || und.beian_hao
    bucket.points.push({ date, qty, mv, price: row.price, cost, undName: displayName })
  }

  const deltas: ValuationLedgerDelta[] = []
  for (const bucket of grouped.values()) {
    const byDate = new Map<string, Point>()
    for (const point of bucket.points) {
      const prev = byDate.get(point.date)
      if (!prev) {
        byDate.set(point.date, point)
        continue
      }
      byDate.set(point.date, {
        ...point,
        qty: prev.qty + point.qty,
        mv: addNullable(prev.mv, point.mv),
        cost: addNullable(prev.cost, point.cost),
      })
    }
    const dates = [...byDate.keys()].sort()
    let prev: { date: string; qty: number; nav: number | null; cost: number | null } | null = null
    for (const date of dates) {
      const point = byDate.get(date)!
      const nav = resolveNav(point.price, point.qty, point.mv)
      if (prev == null) {
        if (isMeaningfulShareDelta(point.qty, nav)) {
          deltas.push({
            parentCode: bucket.parentCode,
            parentName: bucket.parentName,
            parentKey: bucket.parentKey,
            underlyingCode: bucket.und.beian_hao,
            underlyingName: point.undName,
            valuationDate: date,
            applyDate: date,
            prevQty: 0,
            qty: point.qty,
            deltaQty: point.qty,
            prevNav: nav,
            nav,
            prevCost: 0,
            cost: point.cost,
            deltaCost: point.cost,
            firstAppearance: true,
          })
        }
        prev = { date, qty: point.qty, nav, cost: point.cost }
        continue
      }
      const deltaQty = point.qty - prev.qty
      const deltaCost =
        point.cost != null && prev.cost != null
          ? point.cost - prev.cost
          : point.cost != null && prev.cost == null
            ? point.cost
            : null
      if (isMeaningfulShareDelta(deltaQty, prev.nav ?? nav)) {
        deltas.push({
          parentCode: bucket.parentCode,
          parentName: bucket.parentName,
          parentKey: bucket.parentKey,
          underlyingCode: bucket.und.beian_hao,
          underlyingName: point.undName,
          valuationDate: date,
          applyDate: prev.date,
          prevQty: prev.qty,
          qty: point.qty,
          deltaQty,
          prevNav: prev.nav,
          nav,
          prevCost: prev.cost,
          cost: point.cost,
          deltaCost,
          firstAppearance: false,
        })
      }
      prev = { date, qty: point.qty, nav, cost: point.cost }
    }
  }

  const existing = await listServerOpsLedgerRecords()
  const existingById = new Map(existing.map((row) => [row.id, row]))
  const skips = new Set(await listLedgerGenerationSkips())
  const usedConfirmIds = new Set<number>()
  const toWrite: OpsLedgerRow[] = []
  let skippedProtected = 0
  let skippedDeleted = 0
  let confirmMatched = 0
  let inserted = 0
  let updated = 0

  for (const delta of deltas) {
    const id = valuationLedgerGenerationKey(delta.parentKey, delta.underlyingCode, delta.valuationDate)
    if (skips.has(id)) {
      skippedDeleted += 1
      continue
    }
    const prev = existingById.get(id)
    if (prev && isProtectedLedgerRow(prev)) {
      skippedProtected += 1
      continue
    }
    const confirm = matchConfirmToDelta(delta, confirms, usedConfirmIds)
    if (confirm) {
      usedConfirmIds.add(confirm.id)
      confirmMatched += 1
    }
    const row = buildValuationLedgerRow(delta, confirm)
    toWrite.push(row)
    if (prev) updated += 1
    else inserted += 1
  }

  if (toWrite.length > 0) {
    await upsertServerOpsLedgerRecords(toWrite)
  }

  return {
    products: held.length,
    candidates: deltas.length,
    inserted,
    updated,
    skippedProtected,
    skippedDeleted,
    confirmMatched,
  }
}
