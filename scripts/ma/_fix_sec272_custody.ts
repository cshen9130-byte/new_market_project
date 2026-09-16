/**
 * Re-extract SEC272 托管账户余额 from 华泰四级科目 银行存款 市值占比
 * (parent 1002 is currency *** with blank 市值), then refresh list cache.
 */
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"
import type { ValuationAnalysis, ValuationRow } from "@/lib/server/valuation-analyzer"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()
process.env.DB_STATEMENT_TIMEOUT = "0"

const BEIAN = "SEC272"
const PRODUCT = "荣熙如川套利1号"

async function main() {
  const { query } = await import("../../lib/db")
  const { enrichValuationMetrics } = await import("@/lib/server/email-valuation-metrics")
  const { backfillValuationMetricsFromRecords } = await import(
    "@/lib/server/email-valuation-metrics-backfill"
  )
  const { loadEmailFundMetricsLookup, resolveEmailFundMetrics } = await import(
    "@/lib/server/email-valuation-cache-enrich"
  )
  const { refreshManagedProductsListCache } = await import(
    "@/lib/server/managed-products-list-cache-pg"
  )
  const { upsertMetricsLatestForProductCodes, invalidateValuationCache } = await import(
    "@/lib/server/valuation-cache-refresh"
  )

  const rec = await query<{
    id: string
    holdings: ValuationRow[]
    summary: ValuationAnalysis["summary"] | null
    net_asset_value: string | null
  }>(
    `SELECT id, holdings, summary, net_asset_value::text
     FROM ops_email_valuation_records
     WHERE UPPER(BTRIM(product_code)) = $1
     ORDER BY valuation_date DESC, id DESC
     LIMIT 1`,
    [BEIAN],
  )
  const latest = rec[0]
  if (!latest) throw new Error(`No valuation records for ${BEIAN}`)

  const preview = enrichValuationMetrics({
    portfolio_data: Array.isArray(latest.holdings) ? latest.holdings : [],
    summary: latest.summary ?? {
      fund_name: PRODUCT,
      valuation_date: "",
      nav: 0,
      total_asset: 0,
      total_liability: 0,
    },
  }).summary
  console.error("[fix_sec272] preview", {
    id: latest.id,
    storedNav: latest.net_asset_value,
    unit_nav: preview.unit_nav,
    net_asset_value: preview.net_asset_value,
    custody_balance: preview.custody_balance,
  })
  if (!(preview.custody_balance > 0)) {
    throw new Error("custody_balance still 0 after re-extract")
  }

  const sbpc = await query<{ holdings: ValuationRow[]; summary: ValuationAnalysis["summary"] | null }>(
    `SELECT holdings, summary
     FROM ops_email_valuation_records
     WHERE UPPER(BTRIM(product_code)) = 'SBPC20'
     ORDER BY valuation_date DESC, id DESC
     LIMIT 1`,
  )
  if (sbpc[0]) {
    const holdings = Array.isArray(sbpc[0].holdings) ? sbpc[0].holdings : []
    const check = enrichValuationMetrics({
      portfolio_data: holdings,
      summary: sbpc[0].summary ?? {
        fund_name: "",
        valuation_date: "",
        nav: 0,
        total_asset: 0,
        total_liability: 0,
      },
    }).summary
    const demand = holdings.find((row) => {
      const code = String(row.original_code ?? row.code ?? "").replace(/\s+/g, "")
      return code === "1002.01" || code === "100201"
    })
    const demandMv = Number(demand?.market_value ?? 0)
    console.error("[fix_sec272] SBPC20 regression", {
      custody_balance: check.custody_balance,
      demand_mv: demandMv,
      net_asset_value: check.net_asset_value,
    })
    if (demandMv > 0 && Math.abs(check.custody_balance - demandMv) > 1) {
      throw new Error(`SBPC20 custody changed: ${check.custody_balance} vs 活期 ${demandMv}`)
    }
  }

  const backfill = await backfillValuationMetricsFromRecords({ productCodes: [BEIAN] })
  console.error(`[fix_sec272] metrics backfill records=${backfill.recordsUpdated}`)

  const lookup = await loadEmailFundMetricsLookup([BEIAN])
  const metrics = resolveEmailFundMetrics(PRODUCT, BEIAN, lookup)
  console.error("[fix_sec272] lookup", metrics)

  await query(
    `UPDATE managed_products
     SET custody_account_balance = $1
     WHERE product_name ILIKE '%荣熙如川%'
       AND product_name <> '合计'`,
    [metrics.custody_balance],
  )

  const cacheRows = await refreshManagedProductsListCache({ reuseResolvedIdentities: true })
  console.error(`[fix_sec272] list cache refreshed rows=${cacheRows}`)

  const metricsUpserted = await upsertMetricsLatestForProductCodes([BEIAN])
  await invalidateValuationCache([BEIAN])

  const after = await query<{
    src: string
    product_name: string
    custody: string | null
    net_asset_value: string | null
  }>(
    `SELECT 'mp' AS src, product_name, custody_account_balance::text AS custody,
            net_asset_value::text
     FROM managed_products
     WHERE product_name ILIKE '%荣熙如川%'
     UNION ALL
     SELECT 'cache', product_name, custody_balance::text, net_asset_value::text
     FROM ops_managed_products_list_cache
     WHERE beian_hao = 'SEC272' OR product_name ILIKE '%荣熙如川%'
     UNION ALL
     SELECT 'record', fund_name, custody_balance::text, net_asset_value::text
     FROM ops_email_valuation_records
     WHERE UPPER(BTRIM(product_code)) = 'SEC272'
     ORDER BY src, product_name`,
  )

  console.log(JSON.stringify({
    ok: true,
    custody: metrics.custody_balance,
    aum: metrics.net_asset_value,
    cacheRows,
    metricsUpserted,
    after,
  }, null, 2))
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err)
  process.exit(1)
})
