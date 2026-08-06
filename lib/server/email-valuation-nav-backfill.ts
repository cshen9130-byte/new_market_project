/**
 * Backfill ops_email_nav_records from custody 估值表 (ops_email_valuation_records).
 *
 * For funds that receive 估值表 emails but no 净值表, unit NAV lives only in the
 * valuation table until we copy it here. Selection at read time still prefers
 * dedicated NAV streams via preferEmailNavRow / EMAIL_NAV_PRIMARY_SOURCE_FILTER.
 */

import { ensureEmailNavTable, upsertEmailNavRecords, type EmailNavInsert } from "@/lib/server/email-nav-pg"
import { ensureEmailValuationTable } from "@/lib/server/email-valuation-pg"
import {
  isFofUnderlyingValuationEmailRow,
  isPlausibleEmailUnitNav,
} from "@/lib/server/email-nav-query"
import type { NavPoint } from "@/lib/server/list-cache-nav-batch"
import { query } from "@/lib/db"

type ValuationNavRow = {
  id: number
  crawl_email_account: string
  email_uid: string
  sent_at: string | null
  subject: string | null
  sender_email: string | null
  attachment_filename: string | null
  product_code: string | null
  fund_name: string | null
  valuation_date: string
  unit_nav: string | null
  cumulative_nav: string | null
  source: string | null
  summary: unknown
}

function parseOptionalNav(value: string | null | undefined): number | null {
  if (value == null || value === "") return null
  const n = parseFloat(value)
  return Number.isFinite(n) ? n : null
}

/** Read 单位净值 from summary.header_rows when the unit_nav column is null. */
export function unitNavFromValuationSummary(summary: unknown): number | null {
  if (summary == null || typeof summary !== "object") return null
  const headerRows = (summary as { header_rows?: unknown }).header_rows
  if (!Array.isArray(headerRows)) return null

  for (const row of headerRows.slice(0, 20)) {
    if (!Array.isArray(row)) continue
    const cells = row.map((c) => String(c ?? "").trim())
    const joined = cells.join(" ")
    // CMS/招商 often also prints 昨日单位净值 — never treat that as today's NAV.
    if (/昨日|上日|前一|上一|前天/.test(joined)) continue
    if (/累计/.test(joined) && !/单位净值/.test(joined.replace(/累计单位净值/g, ""))) continue

    const inline = joined.match(/(?:^|[^累计])单位净值\s*[：:]\s*(\d+\.\d{3,8})/)
    if (inline) {
      const n = parseFloat(inline[1])
      if (Number.isFinite(n) && isPlausibleEmailUnitNav(n, null)) return n
    }

    for (let i = 0; i < cells.length - 1; i += 1) {
      const label = cells[i].replace(/\s+/g, "")
      if (/昨日|上日|前一|上一|前天/.test(label)) continue
      if (/^(单位净值|今日单位净值|基金份额净值|基金单位净值|份额净值)$/.test(label)
        || (/单位净值/.test(label) && !/累计/.test(label))) {
        const n = parseFloat(cells[i + 1].replace(/,/g, ""))
        if (Number.isFinite(n) && isPlausibleEmailUnitNav(n, null)) return n
      }
    }
  }
  return null
}

function resolveRowUnitNav(row: ValuationNavRow): {
  unitNav: number | null
  needsColumnHeal: boolean
} {
  const fromCol = parseOptionalNav(row.unit_nav)
  const fromHeader = unitNavFromValuationSummary(row.summary)
  // Prefer header 单位净值 when present — it is the Excel ground truth used by repair scripts.
  // Column unit_nav can lag or hold a shifted value after historical date repairs.
  if (fromHeader != null) {
    return {
      unitNav: fromHeader,
      needsColumnHeal: fromCol == null || Math.abs(fromCol - fromHeader) > 1e-9,
    }
  }
  return { unitNav: fromCol, needsColumnHeal: false }
}

function valuationRowToNavInsert(row: ValuationNavRow, unitNav: number): EmailNavInsert | null {
  const cumNav = parseOptionalNav(row.cumulative_nav)
  if (!isPlausibleEmailUnitNav(unitNav, cumNav)) return null

  const code = (row.product_code ?? "").trim().toUpperCase()
  if (
    code
    && isFofUnderlyingValuationEmailRow(
      {
        nav_date: row.valuation_date,
        nav: String(unitNav),
        cumulative_nav: row.cumulative_nav,
        adjusted_nav: null,
        product_code: row.product_code,
        fund_name: row.fund_name,
        attachment_filename: row.attachment_filename,
        subject: row.subject,
        source: row.source ?? "attachment_valuation_table",
      },
      code,
    )
  ) {
    return null
  }

  return {
    crawlEmailAccount: row.crawl_email_account,
    emailUid: row.email_uid,
    sentAt: row.sent_at,
    subject: row.subject ?? "",
    senderEmail: row.sender_email ?? "",
    attachmentFilename: row.attachment_filename ?? "",
    navDate: row.valuation_date.slice(0, 10),
    nav: unitNav,
    cumulativeNav: cumNav,
    adjustedNav: null,
    productCode: row.product_code,
    fundName: row.fund_name,
    source: "attachment_valuation_table",
  }
}

/**
 * Heal CMS/招商 day-shift: when ops_email_nav_records.nav disagrees with the
 * valuation header 单位净值 for the same email/attachment/date, rewrite nav
 * (and column/summary.unit_nav) from the header. Safe to run on --cache-only
 * nightly — scoped to CMS subjects and recent dates only.
 */
export async function healCmsNavDayShiftFromRecords(options?: {
  sinceDate?: string
}): Promise<{ products: number; mismatches: number; navUpserted: number }> {
  await ensureEmailValuationTable()
  await ensureEmailNavTable()

  const sinceDate = options?.sinceDate ?? "2026-07-01"
  const rows = await query<
    ValuationNavRow & { nav_unit: string | null; val_id: number }
  >(
    `SELECT v.id AS val_id, v.crawl_email_account, v.email_uid, v.sent_at::text,
            v.subject, v.sender_email, v.attachment_filename, v.product_code,
            v.fund_name, v.valuation_date::text, v.unit_nav::text, v.cumulative_nav::text,
            v.source, v.summary, n.nav::text AS nav_unit
     FROM ops_email_valuation_records v
     JOIN ops_email_nav_records n
       ON n.crawl_email_account = v.crawl_email_account
      AND n.email_uid = v.email_uid
      AND n.attachment_filename = v.attachment_filename
      AND n.nav_date = v.valuation_date
      AND coalesce(n.product_code, '') = coalesce(v.product_code, '')
      AND n.source = 'attachment_valuation_table'
     WHERE v.valuation_date >= $1::date
       AND coalesce(v.product_code, '') <> ''
       AND (
         v.subject ~ '【估值表】'
         OR coalesce(v.attachment_filename, '') ~ '委托资产资产估值表'
         OR coalesce(v.summary->>'custodian', '') LIKE '%招商证券%'
       )
     ORDER BY v.valuation_date ASC, v.id ASC`,
    [sinceDate],
  )

  const inserts: EmailNavInsert[] = []
  const codes = new Set<string>()
  let mismatches = 0

  for (const row of rows) {
    const { unitNav, needsColumnHeal } = resolveRowUnitNav(row)
    const nav = parseOptionalNav(row.nav_unit)
    if (unitNav == null || nav == null) continue
    if (Math.abs(unitNav - nav) <= 1e-6) continue

    mismatches += 1
    const code = (row.product_code ?? "").trim().toUpperCase()
    if (code) codes.add(code)

    if (needsColumnHeal) {
      await query(
        `UPDATE ops_email_valuation_records SET unit_nav = $1 WHERE id = $2`,
        [unitNav, row.val_id],
      )
    }

    const summaryUnit = parseOptionalNav(
      row.summary != null && typeof row.summary === "object"
        ? String((row.summary as { unit_nav?: unknown }).unit_nav ?? "")
        : null,
    )
    if (
      row.summary != null &&
      typeof row.summary === "object" &&
      (summaryUnit == null || Math.abs(summaryUnit - unitNav) > 1e-9)
    ) {
      await query(
        `UPDATE ops_email_valuation_records
         SET summary = jsonb_set(coalesce(summary, '{}'::jsonb), '{unit_nav}', to_jsonb($1::numeric), true)
         WHERE id = $2`,
        [unitNav, row.val_id],
      )
    }

    const insert = valuationRowToNavInsert(
      { ...row, id: row.val_id },
      unitNav,
    )
    if (insert) inserts.push(insert)
  }

  const navUpserted = await upsertEmailNavRecords(inserts)
  return { products: codes.size, mismatches, navUpserted }
}

/** Copy custody 估值表 unit NAV into ops_email_nav_records (idempotent upsert). */
export async function backfillCustodyValuationNavFromRecords(options?: {
  sinceDate?: string
}): Promise<{ navBackfilled: number; unitNavHealed: number }> {
  await ensureEmailValuationTable()
  await ensureEmailNavTable()

  const sinceDate = options?.sinceDate ?? "1970-01-01"
  // Include null unit_nav rows — many custody sheets only store 单位净值 in summary.header_rows.
  const rows = await query<ValuationNavRow>(
    `SELECT id, crawl_email_account, email_uid, sent_at::text, subject, sender_email,
            attachment_filename, product_code, fund_name,
            valuation_date::text, unit_nav::text, cumulative_nav::text, source, summary
     FROM ops_email_valuation_records
     WHERE valuation_date >= $1::date
     ORDER BY valuation_date ASC, id ASC`,
    [sinceDate],
  )

  const inserts: EmailNavInsert[] = []
  let unitNavHealed = 0
  for (const row of rows) {
    const { unitNav, needsColumnHeal } = resolveRowUnitNav(row)
    if (unitNav == null) continue

    if (needsColumnHeal) {
      await query(
        `UPDATE ops_email_valuation_records SET unit_nav = $1 WHERE id = $2`,
        [unitNav, row.id],
      )
      unitNavHealed += 1
    }

    const insert = valuationRowToNavInsert(row, unitNav)
    if (insert) inserts.push(insert)
  }

  const navBackfilled = await upsertEmailNavRecords(inserts)
  return { navBackfilled, unitNavHealed }
}

function appendNavPoint(
  map: Map<string, NavPoint[]>,
  key: string,
  point: NavPoint,
  replaceExisting = false,
): void {
  const arr = map.get(key) ?? []
  const idx = arr.findIndex((p) => p.nav_date === point.nav_date)
  if (idx >= 0) {
    if (replaceExisting) arr[idx] = point
  } else {
    arr.push(point)
  }
  map.set(key, arr)
}

/** Historical custody 估值表 unit NAV — fallback when 净值表 has no series. */
export async function loadCustodyValuationNavHistory(sinceDate: string): Promise<{
  byCode: Map<string, NavPoint[]>
  byName: Map<string, NavPoint[]>
}> {
  await ensureEmailValuationTable()

  const rows = await query<ValuationNavRow>(
    `SELECT id, crawl_email_account, email_uid, sent_at::text, subject, sender_email,
            attachment_filename, product_code, fund_name,
            valuation_date::text, unit_nav::text, cumulative_nav::text, source, summary
     FROM ops_email_valuation_records
     WHERE valuation_date >= $1::date
     ORDER BY valuation_date ASC, id ASC`,
    [sinceDate],
  )

  const byCode = new Map<string, NavPoint[]>()
  const byName = new Map<string, NavPoint[]>()

  for (const row of rows) {
    const { unitNav } = resolveRowUnitNav(row)
    const cumNav = parseOptionalNav(row.cumulative_nav)
    if (unitNav == null || !isPlausibleEmailUnitNav(unitNav, cumNav)) continue

    const code = (row.product_code ?? "").trim().toUpperCase()
    if (
      code
      && isFofUnderlyingValuationEmailRow(
        {
          nav_date: row.valuation_date,
          nav: String(unitNav),
          cumulative_nav: row.cumulative_nav,
          adjusted_nav: null,
          product_code: row.product_code,
          fund_name: row.fund_name,
          attachment_filename: row.attachment_filename,
          subject: row.subject,
          source: row.source ?? "attachment_valuation_table",
        },
        code,
      )
    ) {
      continue
    }

    const point: NavPoint = {
      nav: unitNav,
      nav_date: row.valuation_date.slice(0, 10),
      source: "attachment_valuation_table",
      subject: row.subject,
    }

    if (code) appendNavPoint(byCode, code, point, true)
    const name = (row.fund_name ?? "").trim()
    if (name) appendNavPoint(byName, name, point, true)
  }

  for (const map of [byCode, byName]) {
    for (const [key, arr] of map) {
      arr.sort((a, b) => b.nav_date.localeCompare(a.nav_date))
      map.set(key, arr)
    }
  }

  return { byCode, byName }
}
