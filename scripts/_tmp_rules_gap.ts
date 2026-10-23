import fs from "fs"
import path from "path"

function loadDotEnv(file: string, override: boolean) {
  const envPath = path.join(process.cwd(), file)
  if (!fs.existsSync(envPath)) return
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    if (!key) continue
    if (!override && process.env[key] !== undefined) continue
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

loadDotEnv(".env", false)
loadDotEnv(".env.local", true)

const CASES = [
  ["AGF75B", "草本慧诚一号B类"],
  ["AHF86C", "顽岩金选中证1000指数增强1号C类"],
  ["AZK00C", "汉鸿青云2号C类"],
  ["BCA56A", "宏锡量化期权1号A类"],
  ["BJV88A", "君信专享3号A类"],
  ["SBDU00", "桫罗稳鸿私募证券投资基金"],
  ["SGM870", "众量资产添运9号私募证券投资基金"],
  ["VM590A", "金和晟明心宏观对冲6号A类"],
] as const

async function main() {
  const { query } = await import("../lib/db")
  const { attachNavGapDiagnosis, parentFilingCodes } = await import("../lib/server/team-data-query-pg")
  const { shareClassFamilyBeianCodes } = await import("../lib/server/share-class-product")
  const rows = CASES.map(([code, name]) => ({ id: code, beian_hao: code, product_name: name }))
  const diagnosed = await attachNavGapDiagnosis(rows)
  const codes = [...new Set(CASES.flatMap(([code]) => shareClassFamilyBeianCodes(code)))]
  const caches = await query<{
    cache_key: string
    beian_hao: string | null
    product_name: string
    n: string
    tip: string | null
    refreshed: string | null
  }>(
    `SELECT cache_key, beian_hao, product_name,
            jsonb_array_length(nav_series)::text AS n,
            tip_nav_date::text AS tip,
            refreshed_at::text AS refreshed
     FROM ops_private_fund_detail_nav_cache
     WHERE UPPER(BTRIM(COALESCE(beian_hao, ''))) = ANY($1::text[])
        OR cache_key = ANY($1::text[])
        OR product_name = ANY($2::text[])`,
    [codes, CASES.map(([, name]) => name)],
  )
  console.log("CACHES")
  for (const row of caches) {
    console.log(JSON.stringify(row))
  }
  console.log("DIAG")
  for (const row of diagnosed) {
    const gap = row.nav_gap
    console.log(JSON.stringify({
      code: row.beian_hao,
      parents: parentFilingCodes(row.beian_hao ?? ""),
      cause: gap?.cause,
      ratio: gap?.ratio,
      missing: gap?.missing,
      holes: gap?.holes.map((hole) => `${hole.from}..${hole.to} miss ${hole.missing.toFixed(1)}`),
      detail: gap?.cause_detail,
      sources: gap?.sources,
    }))
  }

  const spot = await query<{
    code: string
    src: string
    price_date: string
    unit: string | null
    cumulative: string | null
    adjusted: string | null
  }>(
    `SELECT UPPER(BTRIM(product_code)) AS code, COALESCE(source, '') AS src,
            nav_date::text AS price_date, nav::text AS unit,
            cumulative_nav::text AS cumulative, adjusted_nav::text AS adjusted
     FROM ops_email_nav_records
     WHERE UPPER(BTRIM(product_code)) = ANY($1::text[])
       AND nav_date >= '2026-03-01' AND nav_date <= '2026-09-30'
     UNION ALL
     SELECT UPPER(BTRIM(beian_hao)), 'manual', nav_date::text, unit_nav::text,
            cumulative_nav::text, adjusted_nav::text
     FROM ops_team_nav_manual
     WHERE UPPER(BTRIM(beian_hao)) = ANY($1::text[])
       AND nav_date >= '2026-03-01' AND nav_date <= '2026-09-30'
       AND nav_type = 'pre_fee'
     ORDER BY 1, 2, 3`,
    [["SBDU00", "SGM870", "BDU00C"]],
  )
  console.log("SPOT", spot.length)
  for (const row of spot) console.log(JSON.stringify(row))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
