/**
 * Sync email 估值表 metrics into base product tables used by fast list APIs.
 * - managed_products.custody_account_balance / net_asset_value  ← 在管产品
 * - fof_underlying_summary.market_value                         ← FOF底层
 */

import { queryUnbounded } from "@/lib/db"
import { ensureEmailValuationMetricsTables } from "@/lib/server/email-valuation-metrics-pg"
import {
  buildFofUnderlyingSummaryFrom,
  buildManagedProductsFrom,
  fofUnderlyingBeianExpr,
} from "@/lib/server/fof-underlying-query"
import { sqlCustodyValuationPreference } from "@/lib/server/email-valuation-cache-enrich"
import { managedProductsResolvedBeianSqlExpr } from "@/lib/server/managed-product-beian"
import { ensureManagedFofUnderlyingTable } from "@/lib/server/managed-fof-underlying-pg"

export type EmailValuationSyncResult = {
  managedProductsUpdated: number
  fofUnderlyingUpdated: number
}

/** Push latest email valuation metrics into managed_products + fof_underlying_summary. */
export async function syncEmailValuationToProductTables(): Promise<EmailValuationSyncResult> {
  await ensureEmailValuationMetricsTables()
  await ensureManagedFofUnderlyingTable()

  const managedRows = await queryUnbounded<{ n: string }>(
    `WITH mp AS (
       SELECT
         m.id,
         m.product_name,
         ${managedProductsResolvedBeianSqlExpr("m.product_name", fofUnderlyingBeianExpr("m.product_name"))} AS beian_hao
       ${buildManagedProductsFrom("m.product_name")}
       WHERE m.product_name <> '合计'
     ),
     latest AS (
       SELECT DISTINCT ON (UPPER(BTRIM(r.product_code)))
         BTRIM(r.product_code) AS product_code,
         r.custody_balance,
         CASE
           WHEN r.paid_in_capital > 1000 AND r.unit_nav > 0.05
                AND raw_nav IS NOT NULL
                AND raw_nav > r.paid_in_capital * r.unit_nav * 2.5
           THEN r.paid_in_capital * r.unit_nav
           ELSE COALESCE(
             raw_nav,
             CASE
               WHEN r.paid_in_capital > 1000 AND r.unit_nav > 0.05
               THEN r.paid_in_capital * r.unit_nav
             END
           )
         END AS net_asset_value
       FROM (
         SELECT
           r.product_code,
           r.custody_balance,
           r.paid_in_capital,
           r.unit_nav,
           r.valuation_date,
           r.id,
           r.subject,
           r.sender_email,
           r.attachment_filename,
           COALESCE(
             NULLIF(r.net_asset_value, 0),
             NULLIF(r.net_asset, 0),
             CASE
               WHEN r.total_asset > 1000
               THEN r.total_asset - COALESCE(r.total_liability, 0)
             END,
             CASE
               WHEN (r.summary->>'nav') ~ '^[0-9.]+$'
                 AND (r.summary->>'nav')::numeric > 1000
               THEN (r.summary->>'nav')::numeric
             END
           ) AS raw_nav
         FROM ops_email_valuation_records r
         WHERE NULLIF(BTRIM(r.product_code), '') IS NOT NULL
           AND UPPER(BTRIM(r.product_code)) IN (
             SELECT UPPER(BTRIM(mp.beian_hao)) FROM mp
             WHERE NULLIF(BTRIM(mp.beian_hao), '') IS NOT NULL
           )
       ) r
       ORDER BY UPPER(BTRIM(r.product_code)),
                ${sqlCustodyValuationPreference("r")},
                r.valuation_date DESC, r.id DESC
     ),
     best AS (
       SELECT mp.id, v.custody_balance, v.net_asset_value
       FROM mp
       INNER JOIN latest v ON UPPER(BTRIM(v.product_code)) = UPPER(BTRIM(mp.beian_hao))
       WHERE v.custody_balance IS NOT NULL OR v.net_asset_value IS NOT NULL
     ),
     updated AS (
       UPDATE managed_products m
       SET
         custody_account_balance = COALESCE(b.custody_balance, m.custody_account_balance),
         net_asset_value         = COALESCE(b.net_asset_value, m.net_asset_value)
       FROM best b
       WHERE m.id = b.id
         AND (b.custody_balance IS NOT NULL OR b.net_asset_value IS NOT NULL)
       RETURNING 1
     )
     SELECT COUNT(*)::text AS n FROM updated`,
  )

  let fofUnderlyingUpdated = 0
  try {
  const fofRows = await queryUnbounded<{ n: string }>(
    `WITH fof AS (
       SELECT
         f.id,
         f.product_name,
         ${fofUnderlyingBeianExpr("f.product_name")} AS beian_hao
       ${buildFofUnderlyingSummaryFrom("f.product_name")}
       WHERE f.product_name <> '合计'
     ),
     aggregated AS (
       SELECT
         COALESCE(NULLIF(TRIM(UPPER(m.underlying_product_code)), ''), TRIM(m.underlying_name)) AS underlying_key,
         SUM(COALESCE(m.market_value, 0)) AS total_market_value
       FROM ops_managed_fof_underlying m
       WHERE COALESCE(m.market_value, 0) > 0
       GROUP BY COALESCE(NULLIF(TRIM(UPPER(m.underlying_product_code)), ''), TRIM(m.underlying_name))
     ),
     best AS (
       SELECT DISTINCT ON (fof.id)
         fof.id,
         a.total_market_value AS market_value
       FROM fof
       INNER JOIN aggregated a ON (
         (NULLIF(TRIM(fof.beian_hao), '') IS NOT NULL AND a.underlying_key = TRIM(UPPER(fof.beian_hao)))
         OR a.underlying_key = TRIM(fof.product_name)
       )
       WHERE COALESCE(a.total_market_value, 0) > 0
       ORDER BY fof.id, a.total_market_value DESC NULLS LAST
     ),
     updated AS (
       UPDATE fof_underlying_summary f
       SET market_value = b.market_value
       FROM best b
       WHERE f.id = b.id
       RETURNING 1
     )
     SELECT COUNT(*)::text AS n FROM updated`,
  )
  fofUnderlyingUpdated = parseInt(fofRows[0]?.n ?? "0", 10)
  } catch (err) {
    console.warn("[email-valuation-sync] FOF underlying market sync skipped:", err)
  }

  return {
    managedProductsUpdated: parseInt(managedRows[0]?.n ?? "0", 10),
    fofUnderlyingUpdated,
  }
}
