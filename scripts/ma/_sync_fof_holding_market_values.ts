/**
 * After refreshManagedFofUnderlying: rewrite cache + summary 市值 from latest holdings.
 * Usage: npx tsx scripts/ma/_sync_fof_holding_market_values.ts
 */
import { loadProjectEnvFiles, configureEtlDbTimeout } from "@/lib/server/load-project-env"

loadProjectEnvFiles()
configureEtlDbTimeout()

async function main() {
  const { query } = await import("@/lib/db")
  const {
    refreshManagedFofUnderlying,
    loadManagedUnderlyingMarketValueMapFromCache,
    loadManagedUnderlyingMarketValueMap,
  } = await import("@/lib/server/managed-fof-underlying-pg")

  console.log("refreshing managed FOF underlying…")
  const rows = await refreshManagedFofUnderlying({ skipSymbolBackfill: true })
  console.log(JSON.stringify({ managedRows: rows }))

  let map = await loadManagedUnderlyingMarketValueMapFromCache()
  if (map.size === 0) map = await loadManagedUnderlyingMarketValueMap()
  console.log(JSON.stringify({ managedMvIds: map.size }))

  const ids = [...map.keys()].map((id) => parseInt(id, 10)).filter((n) => Number.isFinite(n))
  const mvs = ids.map((id) => map.get(String(id)) ?? 0)

  // Reset cache MVs, then write current holdings.
  await query(`UPDATE ops_fof_overview_list_cache SET market_value = NULL, refreshed_at = NOW()`)
  if (ids.length > 0) {
    await query(
      `UPDATE ops_fof_overview_list_cache AS c
       SET market_value = v.mv, refreshed_at = NOW()
       FROM (
         SELECT UNNEST($1::bigint[]) AS id, UNNEST($2::numeric[]) AS mv
       ) v
       WHERE c.fof_underlying_id = v.id`,
      [ids, mvs],
    )
  }

  if (ids.length > 0) {
    await query(
      `UPDATE fof_underlying_summary AS f
       SET market_value = v.mv, updated_at = NOW()
       FROM (
         SELECT UNNEST($1::bigint[]) AS id, UNNEST($2::numeric[]) AS mv
       ) v
       WHERE f.id = v.id`,
      [ids, mvs],
    )
  }
  await query(
    `UPDATE fof_underlying_summary f
     SET market_value = 0, updated_at = NOW()
     WHERE f.product_name <> '合计'
       AND COALESCE(f.market_value, 0) <> 0
       AND NOT (f.id = ANY($1::bigint[]))`,
    [ids],
  )

  const check = await query<{
    product_name: string
    cache_mv: string | null
    summary_mv: string | null
  }>(
    `SELECT f.product_name, c.market_value::text AS cache_mv, f.market_value::text AS summary_mv
     FROM fof_underlying_summary f
     LEFT JOIN ops_fof_overview_list_cache c ON c.fof_underlying_id = f.id
     WHERE f.product_name IN ('衡颐嘉选2号', '绵烁ETF套利3号A类', '木莲安澜1号A类', '沣跃通达云骥7号混合型', '金鹰增益货币B')
     ORDER BY f.product_name`,
  )
  console.log(JSON.stringify({ samples: check }, null, 2))
  console.log(JSON.stringify({ ok: true, heldProducts: ids.length }))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
