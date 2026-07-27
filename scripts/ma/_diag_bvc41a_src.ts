import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"
import { writeFileSync } from "fs"
ensureScriptDatabaseEnv()
configureEtlDbTimeout()

async function main() {
  const { query } = await import("../../lib/db")
  const { extractNavMetadata, extractNavData } = await import("../../lib/server/email-nav-extract")
  const lines: string[] = []

  const sRongxi =
    "国泰海通证券资产托管发送：棕榈滩泰来三号私募证券投资基金A【荣熙共赢私募证券投资基金】TA虚拟净值_2026-07-24"
  const sJinyu =
    "国泰海通证券资产托管发送：棕榈滩泰来三号私募证券投资基金A【金舆基石一号私募证券投资基金】TA虚拟净值_2026-07-24"
  const body = "净值日期\t单位净值\t累计单位净值\n2026-07-24\t1.0976\t1.0976"
  lines.push(`rongxi meta ${JSON.stringify(extractNavMetadata(sRongxi, body))}`)
  lines.push(`rongxi data ${JSON.stringify(extractNavData(sRongxi, body))}`)
  lines.push(`jinyu meta ${JSON.stringify(extractNavMetadata(sJinyu, body))}`)
  lines.push(`jinyu data ${JSON.stringify(extractNavData(sJinyu, body))}`)

  // All Jul23-24 subjects for 泰来三号 in DB
  const all = await query(
    `SELECT id, nav_date::text, nav::text, product_code, fund_name, left(subject,130) AS subject
     FROM ops_email_nav_records
     WHERE subject ILIKE '%泰来三号%'
       AND (nav_date >= '2026-07-23' OR subject ILIKE '%2026-07-23%' OR subject ILIKE '%2026-07-24%')
     ORDER BY id DESC`,
  )
  lines.push(`\nDB rows mentioning 泰来三号 Jul23/24: ${all.length}`)
  for (const r of all) lines.push(JSON.stringify(r))

  // Misfiled under SAVW72
  const savw = await query(
    `SELECT nav_date::text, nav::text, product_code, fund_name, left(subject,100) AS subject
     FROM ops_email_nav_records
     WHERE product_code = 'SAVW72' AND subject ILIKE '%泰来三号%'
       AND nav_date >= '2026-07-20'
     ORDER BY nav_date DESC`,
  )
  lines.push(`\nSAVW72 misfiled 泰来三号: ${savw.length}`)
  for (const r of savw) lines.push(JSON.stringify(r))

  // valuation nav history
  const vh = await query(
    `SELECT * FROM ops_fof_underlying_valuation_nav_history
     WHERE underlying_code IN ('BVC41A','BVC41','BVE414')
        OR underlying_name ILIKE '%泰来三号%'
     ORDER BY nav_date DESC NULLS LAST LIMIT 20`,
  ).catch(async (e) => {
    const cols = await query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='ops_fof_underlying_valuation_nav_history'`,
    )
    lines.push(`vh cols ${cols.map((c: { column_name: string }) => c.column_name)}`)
    lines.push(`vh err ${e.message}`)
    return []
  })
  lines.push(`\nvaluation hist: ${vh.length}`)
  for (const r of vh) lines.push(JSON.stringify(r).slice(0, 250))

  // managed fof underlying
  const mf = await query(
    `SELECT column_name FROM information_schema.columns WHERE table_name='ops_managed_fof_underlying'`,
  )
  lines.push(`\nmanaged cols: ${mf.map((c: { column_name: string }) => c.column_name).join(",")}`)

  writeFileSync("scripts/ma/_diag_bvc41a_src.txt", lines.join("\n"), "utf8")
  console.log("ok")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
