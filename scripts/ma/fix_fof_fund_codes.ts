/**
 * Fix FOF overview fund codes/names and refresh list cache.
 * Run: npx tsx scripts/ma/fix_fof_fund_codes.ts
 */
import { loadProjectEnvFiles } from "@/lib/server/load-project-env"
loadProjectEnvFiles()

const CORRECTIONS: { oldCode: string; newCode: string; productName: string }[] = [
  { oldCode: "SVN917",  newCode: "VN917B",  productName: "天戈钻选CTA1号B类" },
  { oldCode: "SATL22",  newCode: "ATL22A",  productName: "木莲安澜1号A类" },
  { oldCode: "STG733",  newCode: "TG733C",  productName: "宁苑沛华稳定增长一号C类" },
  { oldCode: "SNW169",  newCode: "NW169B",  productName: "星阔江月2号B类" },
  { oldCode: "SALF51",  newCode: "ALF51B",  productName: "乾上泉对冲一号B类" },
  { oldCode: "SSJ392",  newCode: "SJ392B",  productName: "熙典基金百富1号B类" },
  { oldCode: "STA891",  newCode: "TA891A",  productName: "瀛岳核心A类" },
  { oldCode: "SZG868",  newCode: "ZG868A",  productName: "博衍留芳1号A类" },
  { oldCode: "AZU19A",  newCode: "AZU19A",  productName: "博衍九溪CTA6号A类" },
]

async function main() {
  const { query } = await import("@/lib/db")
  const { fofUnderlyingBeianExpr, buildFofUnderlyingSummaryFrom } = await import("@/lib/server/fof-underlying-query")
  const { refreshFofOverviewListCache } = await import("@/lib/server/fof-overview-list-cache-pg")

  // Remove duplicate 博衍九溪CTA6号 auto-added row (keep id=37)
  const dupDeleted = await query<{ id: number; product_name: string }>(
    `DELETE FROM fof_underlying_summary
     WHERE id = 52 AND product_name ILIKE '%博衍九溪CTA6号%私募证券投资基金%'
     RETURNING id, product_name`,
  )
  if (dupDeleted.length) {
    console.log("Removed duplicate summary row:", dupDeleted[0])
    await query(`DELETE FROM ops_fof_overview_list_cache WHERE fof_underlying_id = 52`)
  }

  // Verify resolved codes after query fix
  console.log("\nResolved beian codes (post-fix query):")
  for (const c of CORRECTIONS) {
    const rows = await query<{ id: string; product_name: string; beian_hao: string | null }>(
      `SELECT f.id::text, f.product_name, ${fofUnderlyingBeianExpr("f.product_name")} AS beian_hao
       ${buildFofUnderlyingSummaryFrom("f.product_name")}
       WHERE f.product_name = $1`,
      [c.productName],
    )
    const row = rows[0]
    const ok = row?.beian_hao === c.newCode
    console.log(`  ${ok ? "✓" : "✗"} ${c.productName}: ${row?.beian_hao ?? "—"} (expected ${c.newCode})`)
  }

  console.log("\nRefreshing FOF overview list cache…")
  const n = await refreshFofOverviewListCache()
  console.log(`Cache refreshed: ${n} rows`)

  console.log("\nCache verification:")
  for (const c of CORRECTIONS) {
    const rows = await query<{ beian_hao: string | null; short_name: string | null }>(
      `SELECT beian_hao, short_name FROM ops_fof_overview_list_cache WHERE product_name = $1`,
      [c.productName],
    )
    const row = rows[0]
    const ok = row?.beian_hao === c.newCode
    console.log(`  ${ok ? "✓" : "✗"} ${c.productName}: code=${row?.beian_hao ?? "—"}, short=${row?.short_name ?? "—"}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
