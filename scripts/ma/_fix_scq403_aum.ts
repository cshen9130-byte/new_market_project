/**
 * One-shot: write 金舆锡泰一号 资产净值 from Huatai SCQ403 估值表, not SBKM53.
 * Run on the app host: npx tsx scripts/ma/_fix_scq403_aum.ts
 */
import { loadProjectEnvFiles, configureEtlDbTimeout } from "@/lib/server/load-project-env"

loadProjectEnvFiles()
configureEtlDbTimeout()
process.env.DB_STATEMENT_TIMEOUT = "0"

const PRODUCT = "金舆锡泰一号"
const BEIAN = "SCQ403"
const HUATAI_AUM_FALLBACK = 51954300.54

async function main() {
  const { queryUnbounded } = await import("@/lib/db")
  const {
    deriveNetAssetValue,
    loadEmailFundMetricsLookup,
    resolveEmailFundMetrics,
  } = await import("@/lib/server/email-valuation-cache-enrich")

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
     WHERE UPPER(BTRIM(product_code)) IN ('SCQ403', 'SBKM53')
        OR fund_name ILIKE '%锡泰%'
     ORDER BY valuation_date DESC, id DESC
     LIMIT 20`,
  )
  console.error(`[fix_scq403] records=${rec.length}`)
  for (const row of rec) {
    const derived = deriveNetAssetValue(row)
    console.error(
      JSON.stringify({
        id: row.id,
        code: row.product_code,
        date: row.valuation_date,
        sender: row.sender_email,
        file: row.attachment_filename,
        stored_aum: row.net_asset_value,
        derived_aum: derived,
        paid_in: row.paid_in_capital,
        unit_nav: row.unit_nav,
        custody: row.custody_balance,
      }),
    )
  }

  const lookup = await loadEmailFundMetricsLookup([BEIAN])
  const metrics = resolveEmailFundMetrics(PRODUCT, BEIAN, lookup)
  console.error("[fix_scq403] lookup", metrics)

  let aum = metrics.net_asset_value
  const custody = metrics.custody_balance
  if (aum == null || aum >= 100_000_000) {
    const huatai = rec.find((row) => {
      const blob = `${row.sender_email ?? ""} ${row.subject ?? ""} ${row.attachment_filename ?? ""}`
      return (
        (row.product_code ?? "").toUpperCase() === BEIAN
        && /htsc|产品估值表|估值表_日报/i.test(blob)
        && !/虚拟净值|TA虚拟/i.test(blob)
      )
    })
    aum = huatai ? deriveNetAssetValue(huatai) : aum
  }
  if (aum == null || aum >= 100_000_000) {
    console.error("[fix_scq403] forcing Huatai fallback AUM", HUATAI_AUM_FALLBACK)
    aum = HUATAI_AUM_FALLBACK
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
  const cache = await queryUnbounded<{ n: string }>(
    `WITH updated AS (
       UPDATE ops_managed_products_list_cache
       SET net_asset_value = $1,
           custody_balance = COALESCE($2::numeric, custody_balance)
       WHERE beian_hao = 'SCQ403'
          OR product_name LIKE '%金舆锡泰一号%'
       RETURNING 1
     )
     SELECT COUNT(*)::text AS n FROM updated`,
    [aum, custody],
  )

  const after = await queryUnbounded<{
    src: string
    product_name: string
    beian: string | null
    net_asset_value: string | null
    custody: string | null
  }>(
    `SELECT 'mp' AS src, product_name, NULL::text AS beian,
            net_asset_value::text, custody_account_balance::text AS custody
     FROM managed_products
     WHERE product_name LIKE '%锡泰%'
     UNION ALL
     SELECT 'cache', product_name, beian_hao,
            net_asset_value::text, custody_balance::text
     FROM ops_managed_products_list_cache
     WHERE product_name LIKE '%锡泰%' OR beian_hao = 'SCQ403'`,
  )

  console.log(JSON.stringify({
    ok: true,
    aum,
    custody,
    managedUpdated: parseInt(mp[0]?.n ?? "0", 10),
    cacheUpdated: parseInt(cache[0]?.n ?? "0", 10),
    after,
  }, null, 2))
}

main().catch((err) => {
  console.error("[fix_scq403] failed", err)
  process.exit(1)
})
