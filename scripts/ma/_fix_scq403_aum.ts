/**
 * Re-extract 金舆锡泰一号 资产净值 from Huatai SCQ403 估值表 holdings,
 * excluding 债券期货合约名义本金. Run on the app host:
 *   npx tsx scripts/ma/_fix_scq403_aum.ts
 */
import { loadProjectEnvFiles, configureEtlDbTimeout } from "@/lib/server/load-project-env"

loadProjectEnvFiles()
configureEtlDbTimeout()
process.env.DB_STATEMENT_TIMEOUT = "0"

const PRODUCT = "金舆锡泰一号"
const BEIAN = "SCQ403"

async function main() {
  const { queryUnbounded } = await import("@/lib/db")
  const { backfillValuationMetricsFromRecords } = await import(
    "@/lib/server/email-valuation-metrics-backfill"
  )
  const {
    deriveNetAssetValue,
    loadEmailFundMetricsLookup,
    resolveEmailFundMetrics,
  } = await import("@/lib/server/email-valuation-cache-enrich")
  const { refreshManagedProductsListCache } = await import(
    "@/lib/server/managed-products-list-cache-pg"
  )

  const backfill = await backfillValuationMetricsFromRecords({ productCodes: [BEIAN] })
  console.error(`[fix_scq403] metrics backfill records=${backfill.recordsUpdated}`)

  const rec = await queryUnbounded<{
    id: string
    product_code: string | null
    fund_name: string | null
    valuation_date: string | null
    subject: string | null
    sender_email: string | null
    attachment_filename: string | null
    custody_balance: string | null
    net_asset_value: string | null
    net_asset: string | null
    total_asset: string | null
    total_liability: string | null
    paid_in_capital: string | null
    unit_nav: string | null
    summary_nav: string | null
  }>(
    `SELECT id::text, product_code, fund_name, valuation_date::text,
            LEFT(COALESCE(subject, ''), 100) AS subject,
            sender_email,
            LEFT(COALESCE(attachment_filename, ''), 100) AS attachment_filename,
            custody_balance::text, net_asset_value::text, net_asset::text,
            total_asset::text, total_liability::text, paid_in_capital::text,
            unit_nav::text, summary->>'nav' AS summary_nav
     FROM ops_email_valuation_records
     WHERE UPPER(BTRIM(product_code)) = $1
     ORDER BY valuation_date DESC, id DESC
     LIMIT 10`,
    [BEIAN],
  )
  for (const row of rec) {
    console.error(JSON.stringify({
      id: row.id,
      date: row.valuation_date,
      stored_aum: row.net_asset_value,
      derived_aum: deriveNetAssetValue(row),
      paid_in: row.paid_in_capital,
      unit_nav: row.unit_nav,
      custody: row.custody_balance,
    }))
  }

  const lookup = await loadEmailFundMetricsLookup([BEIAN])
  const metrics = resolveEmailFundMetrics(PRODUCT, BEIAN, lookup)
  console.error("[fix_scq403] lookup", metrics)

  let aum = metrics.net_asset_value
  const custody = metrics.custody_balance
  if (aum == null || aum >= 100_000_000) {
    const previous = rec.find((row) => {
      const derived = deriveNetAssetValue(row)
      return derived != null && derived >= 1000 && derived < 100_000_000
    })
    aum = previous ? deriveNetAssetValue(previous) : aum
    console.error("[fix_scq403] latest AUM still inflated, using prior Huatai row", aum)
  }
  if (aum == null || aum >= 100_000_000) {
    throw new Error("SCQ403 AUM still inflated after holdings re-extract")
  }

  const mp = await queryUnbounded<{ n: string }>(
    `WITH updated AS (
       UPDATE managed_products
       SET net_asset_value = $1,
           custody_account_balance = COALESCE($2::numeric, custody_account_balance)
       WHERE product_name LIKE '%金舆锡泰一号%'
         AND product_name <> '合计'
       RETURNING 1
     )
     SELECT COUNT(*)::text AS n FROM updated`,
    [aum, custody],
  )

  const cacheRows = await refreshManagedProductsListCache({ reuseResolvedIdentities: true })
  console.error(`[fix_scq403] list cache refreshed rows=${cacheRows}`)

  const after = await queryUnbounded<{
    src: string
    product_name: string
    beian: string | null
    net_asset_value: string | null
    custody: string | null
    unit_nav: string | null
    nav_date: string | null
  }>(
    `SELECT 'mp' AS src, product_name, NULL::text AS beian,
            net_asset_value::text, custody_account_balance::text AS custody,
            NULL::text AS unit_nav, NULL::text AS nav_date
     FROM managed_products
     WHERE product_name LIKE '%锡泰%'
     UNION ALL
     SELECT 'cache', product_name, beian_hao,
            net_asset_value::text, custody_balance::text,
            unit_nav::text, nav_date::text
     FROM ops_managed_products_list_cache
     WHERE product_name LIKE '%锡泰%' OR beian_hao = 'SCQ403'`,
  )

  console.log(JSON.stringify({
    ok: true,
    aum,
    custody,
    managedUpdated: parseInt(mp[0]?.n ?? "0", 10),
    cacheRows,
    after,
  }, null, 2))
}

main().catch((err) => {
  console.error("[fix_scq403] failed", err)
  process.exit(1)
})
