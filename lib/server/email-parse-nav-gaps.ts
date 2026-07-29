/**
 * Identify parse-record emails that look like NAV/估值 sources for a product
 * but have no matching NAV (or valuation unit NAV) stored for the expected date.
 * Used by 解析记录 "净值疑似缺失" filter.
 */

import { query } from "@/lib/db"
import {
  extractFundNameFromText,
  extractProductCodeFromText,
  normalizeFundDisplayName,
} from "@/lib/server/email-nav-extract"
import type { EmailParseRecord } from "@/lib/server/email-parse-records"

const NAV_LOOK_RE = /净值|虚拟净值|业绩报酬|估值表/u
const NON_NAV_RE = /台账|份额明细|投资者明细|持有人明细|交易确认|成交确认|申购确认|赎回确认/u

export function looksLikeNavEmail(subject: string): boolean {
  const s = subject.trim()
  if (!s) return false
  if (!NAV_LOOK_RE.test(s)) return false
  // Pure confirmation/ledger mails that happen to mention 净值 elsewhere are rare;
  // if the subject is clearly ledger/confirm-only, skip.
  if (NON_NAV_RE.test(s) && !/净值波动表|净值表|虚拟净值|估值表|业绩报酬/u.test(s)) return false
  return true
}

export function extractExpectedNavDateFromSubject(subject: string): string | null {
  const iso = subject.match(/(?:^|\D)(20\d{2})-(\d{2})-(\d{2})(?:\D|$)/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  const slash = subject.match(/(?:^|\D)(20\d{2})\/(\d{1,2})\/(\d{1,2})(?:\D|$)/)
  if (slash) {
    return `${slash[1]}-${slash[2].padStart(2, "0")}-${slash[3].padStart(2, "0")}`
  }

  const cn = subject.match(/(20\d{2})年(\d{1,2})月(\d{1,2})日/)
  if (cn) {
    return `${cn[1]}-${cn[2].padStart(2, "0")}-${cn[3].padStart(2, "0")}`
  }

  const compact = subject.match(/(?:^|\D)(20\d{6})(?:\D|$)/)
  if (compact) {
    const s = compact[1]
    const y = s.slice(0, 4)
    const m = s.slice(4, 6)
    const d = s.slice(6, 8)
    const month = Number(m)
    const day = Number(d)
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return `${y}-${m}-${d}`
  }
  return null
}

function ymdFromIso(iso: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  // Use Asia/Shanghai calendar day for China fund NAV mails.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d)
  const y = parts.find((p) => p.type === "year")?.value
  const m = parts.find((p) => p.type === "month")?.value
  const day = parts.find((p) => p.type === "day")?.value
  if (!y || !m || !day) return null
  return `${y}-${m}-${day}`
}

function addCalendarDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + delta)
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(dt.getUTCDate()).padStart(2, "0")
  return `${yy}-${mm}-${dd}`
}

function emailFailedToYieldNav(row: EmailParseRecord): boolean {
  const subject = row.subject ?? ""
  const wantsNav = /净值|虚拟净值|业绩报酬/u.test(subject)
  const wantsVal = /估值表|估值/u.test(subject)

  if (wantsNav && wantsVal) {
    return row.tableNavStatus === "失败" && row.valuationStatus === "失败"
  }
  if (wantsNav) return row.tableNavStatus === "失败"
  if (wantsVal) return row.valuationStatus === "失败"
  return row.tableNavStatus === "失败"
}

type GapCandidate = {
  row: EmailParseRecord
  productCode: string | null
  fundName: string | null
  checkDates: string[]
}

function buildCandidate(row: EmailParseRecord): GapCandidate | null {
  const subject = row.subject ?? ""
  if (!looksLikeNavEmail(subject)) return null
  if (!emailFailedToYieldNav(row)) return null

  const productCode = extractProductCodeFromText(subject)?.trim().toUpperCase() || null
  const fundNameRaw = extractFundNameFromText(subject)
  const fundName = fundNameRaw ? normalizeFundDisplayName(fundNameRaw) : null
  if (!productCode && !fundName) return null

  const fromSubject = extractExpectedNavDateFromSubject(subject)
  const sentYmd = ymdFromIso(row.sentAt)
  const checkDates = new Set<string>()
  if (fromSubject) {
    checkDates.add(fromSubject)
  } else if (sentYmd) {
    // NAV mails often report T-1; treat either day as covering the mail.
    checkDates.add(sentYmd)
    checkDates.add(addCalendarDays(sentYmd, -1))
  }
  if (checkDates.size === 0) return null

  return { row, productCode, fundName, checkDates: [...checkDates] }
}

function presenceKey(code: string | null, fundName: string | null, date: string): string[] {
  const keys: string[] = []
  if (code) keys.push(`c:${code.toUpperCase()}|${date}`)
  if (fundName) keys.push(`n:${fundName}|${date}`)
  return keys
}

async function loadPresentNavKeys(dates: string[]): Promise<Set<string>> {
  const present = new Set<string>()
  if (dates.length === 0) return present

  try {
    const navRows = await query<{
      product_code: string | null
      fund_name: string | null
      nav_date: string
    }>(
      `SELECT DISTINCT
         NULLIF(BTRIM(product_code), '') AS product_code,
         NULLIF(BTRIM(fund_name), '') AS fund_name,
         nav_date::text AS nav_date
       FROM ops_email_nav_records
       WHERE nav_date = ANY($1::date[])
         AND nav IS NOT NULL`,
      [dates],
    )
    for (const r of navRows) {
      const code = r.product_code?.trim().toUpperCase() || null
      const name = r.fund_name ? normalizeFundDisplayName(r.fund_name) : null
      for (const k of presenceKey(code, name, r.nav_date.slice(0, 10))) present.add(k)
    }
  } catch {
    // Table may be missing in some envs — treat as no present rows.
  }

  try {
    const valRows = await query<{
      product_code: string | null
      fund_name: string | null
      valuation_date: string
    }>(
      `SELECT DISTINCT
         NULLIF(BTRIM(product_code), '') AS product_code,
         NULLIF(BTRIM(fund_name), '') AS fund_name,
         valuation_date::text AS valuation_date
       FROM ops_email_valuation_records
       WHERE valuation_date = ANY($1::date[])
         AND unit_nav IS NOT NULL`,
      [dates],
    )
    for (const r of valRows) {
      const code = r.product_code?.trim().toUpperCase() || null
      const name = r.fund_name ? normalizeFundDisplayName(r.fund_name) : null
      for (const k of presenceKey(code, name, r.valuation_date.slice(0, 10))) present.add(k)
    }
  } catch {
    // ignore
  }

  return present
}

function candidateHasPresentNav(c: GapCandidate, present: Set<string>): boolean {
  for (const date of c.checkDates) {
    for (const k of presenceKey(c.productCode, c.fundName, date)) {
      if (present.has(k)) return true
    }
  }
  return false
}

/** Keep only emails that look like NAV/估值 for a product but that product/date is missing in store. */
export async function filterNavDataGapRecords(records: EmailParseRecord[]): Promise<EmailParseRecord[]> {
  const candidates: GapCandidate[] = []
  for (const row of records) {
    const c = buildCandidate(row)
    if (c) candidates.push(c)
  }
  if (candidates.length === 0) return []

  const dates = [...new Set(candidates.flatMap((c) => c.checkDates))]
  const present = await loadPresentNavKeys(dates)
  return candidates.filter((c) => !candidateHasPresentNav(c, present)).map((c) => c.row)
}
