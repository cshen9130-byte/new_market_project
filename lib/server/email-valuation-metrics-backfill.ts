/**
 * Re-extract custody_balance / net_asset_value from stored holdings JSONB.
 */

import { query } from "@/lib/db"
import { resolveCustodianFromValuationRecord } from "@/lib/server/email-valuation-custodian"
import { enrichValuationMetrics } from "@/lib/server/email-valuation-metrics"
import type { ValuationAnalysis, ValuationRow } from "@/lib/server/valuation-analyzer"
import { ensureEmailValuationTable } from "@/lib/server/email-valuation-pg"

export async function backfillValuationCustodianFromRecords(): Promise<{ recordsUpdated: number; recordsCleared: number }> {
  await ensureEmailValuationTable()

  const cleared = await query<{ n: string }>(
    `WITH updated AS (
       UPDATE ops_email_valuation_records
       SET custodian = NULL
       WHERE (summary->>'custodian' IS NULL OR BTRIM(summary->>'custodian') = '')
         AND custodian IS NOT NULL
         AND BTRIM(custodian) <> ''
       RETURNING 1
     )
     SELECT COUNT(*)::text AS n FROM updated`,
  )
  const recordsCleared = parseInt(cleared[0]?.n ?? "0", 10)

  const stripped = await query<{ n: string }>(
    `WITH updated AS (
       UPDATE ops_email_valuation_records
       SET custodian = NULL,
           summary = summary - 'custodian'
       WHERE summary->>'custodian' = '招商证券股份有限公司'
         AND fund_name ILIKE '%海宸%'
       RETURNING 1
     )
     SELECT COUNT(*)::text AS n FROM updated`,
  )
  const recordsStripped = parseInt(stripped[0]?.n ?? "0", 10)

  const records = await query<{
    id: string
    summary: ValuationAnalysis["summary"] | null
    custodian: string | null
    sender_email: string | null
    subject: string | null
    attachment_filename: string | null
  }>(
    `SELECT id, summary, custodian, sender_email, subject, attachment_filename
     FROM ops_email_valuation_records`,
  )

  let recordsUpdated = 0
  for (const record of records) {
    const summary = record.summary ?? null
    const custodian = resolveCustodianFromValuationRecord({
      custodian: record.custodian,
      summaryCustodian: summary?.custodian ?? null,
      headerRows: summary?.header_rows ?? null,
      senderEmail: record.sender_email,
      subject: record.subject,
      attachmentFilename: record.attachment_filename,
    })
    if (!custodian) continue
    if (custodian === record.custodian?.trim() && summary?.custodian?.trim() === custodian) continue

    await query(
      `UPDATE ops_email_valuation_records
       SET custodian = $2,
           summary = COALESCE(summary, '{}'::jsonb) || jsonb_build_object('custodian', $2::text)
       WHERE id = $1`,
      [parseInt(record.id, 10), custodian],
    )
    recordsUpdated++
  }

  return { recordsUpdated, recordsCleared: recordsCleared + recordsStripped }
}

export async function backfillValuationMetricsFromRecords(options?: {
  productCodes?: string[]
}): Promise<{ recordsUpdated: number }> {
  await ensureEmailValuationTable()

  const codes = [...new Set(
    (options?.productCodes ?? [])
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean),
  )]
  const params: unknown[] = []
  let codeFilter = ""
  if (codes.length > 0) {
    params.push(codes)
    codeFilter = " AND UPPER(BTRIM(product_code)) = ANY($1::text[])"
  }

  const records = await query<{
    id: string
    sender_email: string | null
    subject: string | null
    attachment_filename: string | null
    holdings: ValuationRow[]
    summary: ValuationAnalysis["summary"] | null
    unit_nav: string | null
  }>(
    `SELECT id, sender_email, subject, attachment_filename, holdings, summary, unit_nav::text
     FROM ops_email_valuation_records
     WHERE jsonb_array_length(holdings) > 0${codeFilter}`,
    params,
  )

  let recordsUpdated = 0
  const total = records.length
  if (total > 0) {
    console.error(`[valuation-metrics-backfill] processing ${total} valuation records…`)
  }
  for (const record of records) {
    if (recordsUpdated > 0 && recordsUpdated % 100 === 0) {
      console.error(`[valuation-metrics-backfill] ${recordsUpdated}/${total} records updated…`)
    }
    const holdings = Array.isArray(record.holdings) ? record.holdings : []
    const analysis: ValuationAnalysis = {
      portfolio_data: holdings,
      summary: record.summary ?? {
        fund_name: "",
        valuation_date: "",
        nav: 0,
        total_asset: 0,
        total_liability: 0,
      },
    }
    const { summary } = enrichValuationMetrics(analysis)
    const custodian = resolveCustodianFromValuationRecord({
      custodian: summary.custodian,
      summaryCustodian: summary.custodian,
      headerRows: summary.header_rows ?? null,
      senderEmail: record.sender_email,
      subject: record.subject,
      attachmentFilename: record.attachment_filename,
    })
    let paidInCapital = summary.paid_in_capital
    if (paidInCapital <= 0 && summary.net_asset_value > 0) {
      const storedUnitNav = parseFloat(record.unit_nav ?? "")
      if (Number.isFinite(storedUnitNav) && storedUnitNav > 0.05) {
        paidInCapital = summary.net_asset_value / storedUnitNav
      }
    }
    await query(
      `UPDATE ops_email_valuation_records
       SET custody_balance = $2,
           net_asset_value = $3,
           paid_in_capital = $4,
           total_asset = $5,
           total_liability = $6,
           custodian = COALESCE(NULLIF(BTRIM(custodian), ''), $7),
           summary = $8
       WHERE id = $1`,
      [
        parseInt(record.id, 10),
        summary.custody_balance > 0 ? summary.custody_balance : null,
        summary.net_asset_value > 0 ? summary.net_asset_value : null,
        paidInCapital > 0 ? paidInCapital : null,
        summary.total_asset > 0 ? summary.total_asset : null,
        summary.total_liability > 0 ? summary.total_liability : null,
        custodian,
        JSON.stringify({ ...summary, custodian: custodian ?? summary.custodian ?? null }),
      ],
    )
    recordsUpdated++
  }

  if (total > 0) {
    console.error(`[valuation-metrics-backfill] done — ${recordsUpdated}/${total} records updated`)
  }

  return { recordsUpdated }
}
