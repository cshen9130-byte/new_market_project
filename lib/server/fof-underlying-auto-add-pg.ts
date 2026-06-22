/**
 * Auto-add newly discovered FOF 底层 (underlying funds) from email 估值表
 * into the shared product tables that power the 运维 FOF底层 and 投资 FOF底层 UI views.
 *
 * Called after refreshManagedFofUnderlying() populates ops_managed_fof_underlying.
 *
 * Target tables:
 *   fof_underlying_summary  — one row per underlying fund (运维 + 投资 overview views)
 *   fof_underlying_detail   — one row per (FOF fund × underlying) pair (投资 detail view)
 */

import { query } from "@/lib/db"
import { ensureManagedFofUnderlyingTable } from "@/lib/server/managed-fof-underlying-pg"

export type FofUnderlyingAutoAddResult = {
  /** Rows added to fof_underlying_summary (新增到运维/投资 FOF底层汇总表) */
  opsFofUnderlyingAdded: number
  /** Rows added to fof_underlying_detail (新增到投资 FOF底层明细表) */
  detailFofUnderlyingAdded: number
}

/**
 * For every unique underlying fund in ops_managed_fof_underlying:
 *  1. Add to fof_underlying_summary if not already present (by product_name match).
 *  2. Add to fof_underlying_detail if the (fof_fund_name, product_name) pair is absent.
 *
 * Existing rows are never modified — this is an ADD-only operation.
 */
export async function autoAddFofUnderlyingToTables(): Promise<FofUnderlyingAutoAddResult> {
  await ensureManagedFofUnderlyingTable()

  // ── 1. fof_underlying_summary (运维 FOF底层 + 投资 FOF底层 overview) ──────────
  // Match by exact name (case-insensitive, trimmed). Skip products already present.
  const summaryRows = await query<{ n: string }>(
    `WITH new_underlying AS (
       SELECT DISTINCT ON (LOWER(TRIM(underlying_name)))
         underlying_name
       FROM ops_managed_fof_underlying
       WHERE NULLIF(TRIM(underlying_name), '') IS NOT NULL
       ORDER BY LOWER(TRIM(underlying_name)), valuation_date DESC
     ),
     max_seq AS (
       SELECT
         COALESCE(MAX(sequence_no), 0)       AS seq,
         COALESCE(MAX(source_row_number), 0) AS src_row
       FROM fof_underlying_summary
     ),
     to_add AS (
       SELECT
         n.underlying_name,
         ROW_NUMBER() OVER (ORDER BY n.underlying_name) AS rn
       FROM new_underlying n
       WHERE NOT EXISTS (
         SELECT 1 FROM fof_underlying_summary f
         WHERE LOWER(TRIM(f.product_name)) = LOWER(TRIM(n.underlying_name))
       )
     ),
     inserted AS (
       INSERT INTO fof_underlying_summary (product_name, sequence_no, source_row_number, source_file, row_hash)
       SELECT
         a.underlying_name,
         (SELECT seq     FROM max_seq) + a.rn,
         (SELECT src_row FROM max_seq) + a.rn,
         'email_valuation_auto',
         MD5(a.underlying_name || ':email_valuation_auto:' || ((SELECT src_row FROM max_seq) + a.rn)::text)
       FROM to_add a
       RETURNING 1
     )
     SELECT COUNT(*)::text AS n FROM inserted`,
  )

  // ── 2. fof_underlying_detail (投资 FOF底层 明细 view) ─────────────────────────
  // Unique key is (fof_fund_name, product_name). ON CONFLICT DO NOTHING is safe
  // because the table has CONSTRAINT fof_underlying_detail_fof_product_uq UNIQUE
  // (fof_fund_name, product_name).
  const detailRows = await query<{ n: string }>(
    `WITH to_add AS (
       SELECT DISTINCT
         fof_product_name                             AS fof_fund_name,
         underlying_name                              AS product_name,
         NULLIF(TRIM(underlying_product_code), '')    AS beian_hao
       FROM ops_managed_fof_underlying
       WHERE NULLIF(TRIM(underlying_name), '') IS NOT NULL
         AND NULLIF(TRIM(fof_product_name), '') IS NOT NULL
     ),
     inserted AS (
       INSERT INTO fof_underlying_detail (fof_fund_name, product_name, beian_hao, source_file)
       SELECT
         a.fof_fund_name,
         a.product_name,
         a.beian_hao,
         'email_valuation_auto'
       FROM to_add a
       WHERE NOT EXISTS (
         SELECT 1 FROM fof_underlying_detail d
         WHERE LOWER(TRIM(d.fof_fund_name)) = LOWER(TRIM(a.fof_fund_name))
           AND LOWER(TRIM(d.product_name))  = LOWER(TRIM(a.product_name))
       )
       ON CONFLICT (fof_fund_name, product_name) DO NOTHING
       RETURNING 1
     )
     SELECT COUNT(*)::text AS n FROM inserted`,
  )

  return {
    opsFofUnderlyingAdded: parseInt(summaryRows[0]?.n ?? "0", 10),
    detailFofUnderlyingAdded: parseInt(detailRows[0]?.n ?? "0", 10),
  }
}
