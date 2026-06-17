/**
 * Sync email 估值表 metrics into base product tables used by fast list APIs.
 * - managed_products.custody_account_balance / net_asset_value  ← 在管产品
 * - fof_underlying_summary.market_value                         ← FOF底层
 */

import { query } from "@/lib/db"
import { ensureEmailValuationMetricsTables } from "@/lib/server/email-valuation-metrics-pg"
import {
  buildFofUnderlyingSummaryFrom,
  buildManagedProductsFrom,
  FOF_UNDERLYING_BEIAN_EXPR,
} from "@/lib/server/fof-underlying-query"
import { sqlFundNameMatch } from "@/lib/server/fund-name-match"

export type EmailValuationSyncResult = {
  managedProductsUpdated: number
  fofUnderlyingUpdated: number
}

/** Push latest email valuation metrics into managed_products + fof_underlying_summary. */
export async function syncEmailValuationToProductTables(): Promise<EmailValuationSyncResult> {
  await ensureEmailValuationMetricsTables()

  const managedRows = await query<{ n: string }>(
    `WITH mp AS (
       SELECT
         m.id,
         m.product_name,
         ${FOF_UNDERLYING_BEIAN_EXPR} AS beian_hao
       ${buildManagedProductsFrom("m.product_name")}
       WHERE m.product_name <> '合计'
     ),
     best AS (
       SELECT DISTINCT ON (mp.id)
         mp.id,
         v.custody_balance,
         v.net_asset_value
       FROM mp
       INNER JOIN ops_email_valuation_fund_metrics_latest v ON (
         (NULLIF(TRIM(v.product_code), '') IS NOT NULL AND v.product_code = mp.beian_hao)
         OR TRIM(v.fund_name) = TRIM(mp.product_name)
         OR ${sqlFundNameMatch("v.fund_name", "mp.product_name")}
       )
       ORDER BY mp.id, v.valuation_date DESC
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

  const fofRows = await query<{ n: string }>(
    `WITH fof AS (
       SELECT
         f.id,
         f.product_name,
         ${FOF_UNDERLYING_BEIAN_EXPR} AS beian_hao
       ${buildFofUnderlyingSummaryFrom("f.product_name")}
       WHERE f.product_name <> '合计'
     ),
     best AS (
       SELECT DISTINCT ON (fof.id)
         fof.id,
         v.market_value
       FROM fof
       INNER JOIN ops_email_valuation_underlying_market_latest v ON (
         (NULLIF(TRIM(v.underlying_product_code), '') IS NOT NULL AND v.underlying_product_code = fof.beian_hao)
         OR TRIM(v.underlying_name) = TRIM(fof.product_name)
         OR ${sqlFundNameMatch("v.underlying_name", "fof.product_name")}
       )
       WHERE COALESCE(v.market_value, 0) > 0
       ORDER BY fof.id, v.valuation_date DESC, v.market_value DESC NULLS LAST
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

  return {
    managedProductsUpdated: parseInt(managedRows[0]?.n ?? "0", 10),
    fofUnderlyingUpdated: parseInt(fofRows[0]?.n ?? "0", 10),
  }
}
