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
import { SQL_MANAGED_FOF_UNDERLYING_IS_DIRECT_EQUITY_OR_ETF } from "@/lib/server/fund-holding-code"

export type FofUnderlyingAutoAddResult = {
  /** Rows added to fof_underlying_summary (新增到运维/投资 FOF底层汇总表) */
  opsFofUnderlyingAdded: number
  /** Rows added to fof_underlying_detail (新增到投资 FOF底层明细表) */
  detailFofUnderlyingAdded: number
}

/**
 * Drop 估值表 subject-path prefixes (场外_已上市_开放式_私募_成本.XXX → XXX)
 * so catalog matching uses the real fund name.
 */
function sqlCatalogFundName(col: string): string {
  return `COALESCE(NULLIF(BTRIM(
    CASE
      WHEN ${col} LIKE '场外%' AND STRPOS(${col}, '.') > 0
        THEN SUBSTRING(${col} FROM '([^.]+)$')
      WHEN ${col} LIKE '场外%'
        THEN REGEXP_REPLACE(${col}, '^场外[_/[:space:].]+', '')
      ELSE ${col}
    END
  ), ''), ${col})`
}

/**
 * Normalize a fund name for duplicate detection:
 * strip 场外_ paths, legal suffixes, and treat trailing "A" as "A类"
 * so "天戈钻选CTA1号私募证券投资基金B类" and "天戈钻选CTA1号B类" match,
 * and "场外_…成本.特夫郁金香全量化" matches "特夫郁金香全量化".
 */
function normExpr(col: string): string {
  const catalog = sqlCatalogFundName(col)
  return `LOWER(BTRIM(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        ${catalog},
        '(私募证券投资基金|私募股权投资基金|私募基金|证券投资基金)',
        '',
        'g'
      ),
      '([A-Za-z])类?$',
      '\\1类'
    )
  ))`
}

/**
 * Remove 估值表 场外_… / email_valuation_auto aliases that duplicate an existing
 * FOF底层汇总 row (same 备案号 or same normalized name).
 */
export async function removeFofUnderlyingSummaryAliases(): Promise<number> {
  const doomed = await query<{ id: number; product_name: string }>(
    `WITH keepers AS (
       SELECT
         f.id,
         NULLIF(UPPER(BTRIM(c.beian_hao)), '') AS beian,
         ${normExpr("f.product_name")} AS norm_name
       FROM fof_underlying_summary f
       LEFT JOIN ops_fof_overview_list_cache c ON c.fof_underlying_id = f.id
       WHERE f.product_name <> '合计'
         AND f.product_name NOT LIKE '场外%'
     ),
     aliases AS (
       SELECT
         f.id,
         f.product_name,
         NULLIF(UPPER(BTRIM(c.beian_hao)), '') AS beian,
         ${normExpr("f.product_name")} AS norm_name
       FROM fof_underlying_summary f
       LEFT JOIN ops_fof_overview_list_cache c ON c.fof_underlying_id = f.id
       WHERE f.product_name <> '合计'
         AND f.product_name LIKE '场外%'
     )
     SELECT a.id, a.product_name
     FROM aliases a
     WHERE EXISTS (
       SELECT 1 FROM keepers k
       WHERE (a.beian IS NOT NULL AND k.beian IS NOT NULL AND a.beian = k.beian)
          OR a.norm_name = k.norm_name
     )`,
  )
  if (doomed.length === 0) return 0

  console.warn(
    `[fof-underlying-auto-add] removed ${doomed.length} alias duplicate(s): ${doomed
      .map((r) => `id=${r.id} ${r.product_name}`)
      .join("; ")}`,
  )

  const ids = doomed.map((r) => r.id)
  await query(
    `DELETE FROM ops_fof_overview_list_cache WHERE fof_underlying_id = ANY($1::int[])`,
    [ids],
  )
  await query(
    `DELETE FROM fof_underlying_summary WHERE id = ANY($1::int[])`,
    [ids],
  )
  return doomed.length
}

/**
 * For every unique underlying fund in ops_managed_fof_underlying:
 *  1. Add to fof_underlying_summary if not already present (normalised name match).
 *  2. Add to fof_underlying_detail if the (fof_fund_name, product_name) pair is absent.
 *
 * Existing catalog rows are kept. Valuation-table 场外_ aliases that duplicate an
 * existing product are removed before new rows are inserted.
 */
export async function autoAddFofUnderlyingToTables(): Promise<FofUnderlyingAutoAddResult> {
  await ensureManagedFofUnderlyingTable()
  await removeFofUnderlyingSummaryAliases()

  const normUnderlyingCol = normExpr("underlying_name")
  const normUnderlyingFromN = normExpr("n.underlying_name")
  const normSummary    = normExpr("f.product_name")
  const catalogUnderlying = sqlCatalogFundName("a.underlying_name")
  const normFofEmail   = normExpr("fof_product_name")
  const normDetailFof  = normExpr("d.fof_fund_name")
  const normDetailProd = normExpr("d.product_name")
  const normEmailProd  = normExpr("a.product_name")
  const normEmailFof   = normExpr("a.fof_fund_name")
  const catalogDetailProd = sqlCatalogFundName("a.product_name")

  // ── 1. fof_underlying_summary (运维 FOF底层 + 投资 FOF底层 overview) ──────────
  const summaryRows = await query<{ n: string }>(
    `WITH new_underlying AS (
       SELECT DISTINCT ON (COALESCE(NULLIF(TRIM(UPPER(underlying_product_code)), ''), ${normUnderlyingCol}))
         underlying_name,
         NULLIF(TRIM(UPPER(underlying_product_code)), '') AS underlying_product_code
       FROM ops_managed_fof_underlying m
       WHERE NULLIF(TRIM(m.underlying_name), '') IS NOT NULL
         AND NOT ${SQL_MANAGED_FOF_UNDERLYING_IS_DIRECT_EQUITY_OR_ETF}
       ORDER BY COALESCE(NULLIF(TRIM(UPPER(underlying_product_code)), ''), ${normUnderlyingCol}), valuation_date DESC
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
         n.underlying_product_code,
         ROW_NUMBER() OVER (ORDER BY n.underlying_name) AS rn
       FROM new_underlying n
       WHERE NOT EXISTS (
         SELECT 1 FROM fof_underlying_summary f
         WHERE ${normSummary} = ${normUnderlyingFromN}
       )
         AND NOT EXISTS (
           SELECT 1 FROM ops_fof_overview_list_cache c
           WHERE n.underlying_product_code IS NOT NULL
             AND NULLIF(BTRIM(c.beian_hao), '') IS NOT NULL
             AND UPPER(BTRIM(c.beian_hao)) = n.underlying_product_code
         )
         AND NOT EXISTS (
           SELECT 1 FROM fof_underlying_detail d
           WHERE n.underlying_product_code IS NOT NULL
             AND NULLIF(BTRIM(d.beian_hao), '') IS NOT NULL
             AND UPPER(BTRIM(d.beian_hao)) = n.underlying_product_code
         )
     ),
     inserted AS (
       INSERT INTO fof_underlying_summary (product_name, sequence_no, source_row_number, source_file, row_hash)
       SELECT
         ${catalogUnderlying},
         (SELECT seq     FROM max_seq) + a.rn,
         (SELECT src_row FROM max_seq) + a.rn,
         'email_valuation_auto',
         MD5(${catalogUnderlying} || ':email_valuation_auto:' || ((SELECT src_row FROM max_seq) + a.rn)::text)
       FROM to_add a
       RETURNING 1
     )
     SELECT COUNT(*)::text AS n FROM inserted`,
  )

  // ── 2. fof_underlying_detail (投资 FOF底层 明细 view) ─────────────────────────
  const detailRows = await query<{ n: string }>(
    `WITH to_add AS (
       SELECT DISTINCT ON (${normFofEmail}, ${normUnderlyingCol})
         fof_product_name                             AS fof_fund_name,
         underlying_name                              AS product_name,
         NULLIF(TRIM(underlying_product_code), '')    AS beian_hao
       FROM ops_managed_fof_underlying m
       WHERE NULLIF(TRIM(m.underlying_name), '') IS NOT NULL
         AND NOT ${SQL_MANAGED_FOF_UNDERLYING_IS_DIRECT_EQUITY_OR_ETF}
         AND NULLIF(TRIM(m.fof_product_name), '') IS NOT NULL
       ORDER BY ${normFofEmail}, ${normUnderlyingCol}
     ),
     inserted AS (
       INSERT INTO fof_underlying_detail (fof_fund_name, product_name, beian_hao, source_file)
       SELECT
         a.fof_fund_name,
         ${catalogDetailProd},
         a.beian_hao,
         'email_valuation_auto'
       FROM to_add a
       WHERE NOT EXISTS (
         SELECT 1 FROM fof_underlying_detail d
         WHERE ${normDetailFof}  = ${normEmailFof}
           AND (
             ${normDetailProd} = ${normEmailProd}
             OR (
               a.beian_hao IS NOT NULL
               AND NULLIF(BTRIM(d.beian_hao), '') IS NOT NULL
               AND UPPER(BTRIM(d.beian_hao)) = UPPER(BTRIM(a.beian_hao))
             )
           )
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

/**
 * Rebuild ops_managed_fof_underlying from latest 估值表, then insert any newly
 * seen underlyings into fof_underlying_summary / fof_underlying_detail.
 * Used by full ETL and by light polls after a managed FOF 估值表 arrives.
 */
export async function refreshManagedFofUnderlyingAndAutoAdd(
  options: {
    skipSymbolBackfill?: boolean
    skipNavBackfill?: boolean
    productCodes?: string[]
  } = {},
): Promise<FofUnderlyingAutoAddResult & { managedRows: number }> {
  const { refreshManagedFofUnderlying } = await import(
    "@/lib/server/managed-fof-underlying-pg"
  )
  const managedRows = await refreshManagedFofUnderlying({
    skipSymbolBackfill: options.skipSymbolBackfill !== false,
    skipNavBackfill: options.skipNavBackfill !== false,
    productCodes: options.productCodes,
  })
  const added = await autoAddFofUnderlyingToTables()
  return { managedRows, ...added }
}
