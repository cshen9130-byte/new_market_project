import { loadProjectEnvFiles, configureEtlDbTimeout } from "@/lib/server/load-project-env"

loadProjectEnvFiles()
configureEtlDbTimeout()

async function main() {
  const { query } = await import("@/lib/db")
  const { loadDetailNavSeriesFast, lookupListCacheFundHeader } = await import(
    "@/lib/server/fund-detail-fast-path"
  )
  const { loadMergedFundNavRows } = await import("@/lib/server/fund-nav-series")

  const code = "SCU622"
  const name = "金舆稳健增长1号FOF"
  const full = "金舆稳健增长1号FOF私募证券投资基金"

  const header = await lookupListCacheFundHeader(code)
  console.log("listHeader", header?.source, header?.nav_date, header?.unit_nav)

  const merged = await loadMergedFundNavRows(code, full, name)
  const mTip = merged[merged.length - 1]
  console.log("merged tip", mTip?.price_date, mTip?.nav)

  const detail = await loadDetailNavSeriesFast({
    beian_hao: code,
    product_name: full,
    short_name: name,
    rawId: code,
  })
  const dTip = detail[detail.length - 1]
  console.log("detail tip", dTip?.price_date, dTip?.nav)

  const cache = await query(
    `SELECT tip_nav_date::text, tip_unit_nav::text FROM ops_private_fund_detail_nav_cache
     WHERE beian_hao = $1 OR cache_key = $1 LIMIT 3`,
    [code],
  )
  console.log("detail cache", cache)

  const track = await query(
    `SELECT unit_nav::text, nav_date::text FROM ops_tracking_funds_list_cache WHERE beian_hao = $1`,
    [code],
  )
  console.log("tracking", track)

  const managed = await query(
    `SELECT unit_nav::text, nav_date::text, return_pct::text FROM ops_managed_products_list_cache WHERE beian_hao = $1`,
    [code],
  )
  console.log("managed", managed)

  if (!dTip || dTip.price_date !== "2026-08-11" || Number(dTip.nav) !== 1.0004) {
    throw new Error(`Unexpected detail tip ${dTip?.price_date} ${dTip?.nav}`)
  }
}

void main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
