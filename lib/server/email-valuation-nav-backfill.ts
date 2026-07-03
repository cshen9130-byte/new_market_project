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
import { query } from "@/lib/db"

type ValuationNavRow = {
  crawl_email_account: string
  email_uid: string
  sent_at: string | null
  subject: string | null
  sender_email: string | null
  attachment_filename: string | null
  product_code: string | null
  fund_name: string | null
  valuation_date: string
  unit_nav: string
  cumulative_nav: string | null
  source: string | null
}

function parseOptionalNav(value: string | null | undefined): number | null {
  if (value == null || value === "") return null
  const n = parseFloat(value)
  return Number.isFinite(n) ? n : null
}

function valuationRowToNavInsert(row: ValuationNavRow): EmailNavInsert | null {
  const unitNav = parseOptionalNav(row.unit_nav)
  const cumNav = parseOptionalNav(row.cumulative_nav)
  if (unitNav == null || !isPlausibleEmailUnitNav(unitNav, cumNav)) return null

  const code = (row.product_code ?? "").trim().toUpperCase()
  if (
    code
    && isFofUnderlyingValuationEmailRow(
      {
        nav_date: row.valuation_date,
        nav: row.unit_nav,
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

/** Copy custody 估值表 unit NAV into ops_email_nav_records (idempotent upsert). */
export async function backfillCustodyValuationNavFromRecords(options?: {
  sinceDate?: string
}): Promise<{ navBackfilled: number }> {
  await ensureEmailValuationTable()
  await ensureEmailNavTable()

  const sinceDate = options?.sinceDate ?? "1970-01-01"
  const rows = await query<ValuationNavRow>(
    `SELECT crawl_email_account, email_uid, sent_at::text, subject, sender_email,
            attachment_filename, product_code, fund_name,
            valuation_date::text, unit_nav::text, cumulative_nav::text, source
     FROM ops_email_valuation_records
     WHERE valuation_date >= $1::date
       AND unit_nav IS NOT NULL
     ORDER BY valuation_date ASC, id ASC`,
    [sinceDate],
  )

  const inserts: EmailNavInsert[] = []
  for (const row of rows) {
    const insert = valuationRowToNavInsert(row)
    if (insert) inserts.push(insert)
  }

  const navBackfilled = await upsertEmailNavRecords(inserts)
  return { navBackfilled }
}
