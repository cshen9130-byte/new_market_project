/**
 * Remove duplicate rows in fof_underlying_detail where the email auto-add inserted
 * the full legal name (e.g. "X私募证券投资基金B类") when the short name ("XB类")
 * already existed from the Excel import.
 *
 * Run:  npx tsx scripts/ma/fix_fof_detail_duplicates.ts
 */
import { loadProjectEnvFiles } from "@/lib/server/load-project-env"
loadProjectEnvFiles()

const STRIP_SQL = `REGEXP_REPLACE($COL$, '(私募证券投资基金|私募股权投资基金|私募基金|证券投资基金)', '', 'g')`
function norm(col: string) {
  return `LOWER(TRIM(${STRIP_SQL.replace(/\$COL\$/g, col)}))`
}

async function main() {
  const { query } = await import("@/lib/db")

  // Find auto-added rows whose normalised (fof_fund_name, product_name) matches an existing non-auto row
  const dupes = await query<{ id: number; fof_fund_name: string; product_name: string }>(
    `SELECT a.id, a.fof_fund_name, a.product_name
     FROM fof_underlying_detail a
     WHERE a.source_file = 'email_valuation_auto'
       AND EXISTS (
         SELECT 1 FROM fof_underlying_detail b
         WHERE b.source_file <> 'email_valuation_auto'
           AND ${norm("b.fof_fund_name")} = ${norm("a.fof_fund_name")}
           AND ${norm("b.product_name")}  = ${norm("a.product_name")}
       )
     ORDER BY a.id`,
  )

  console.log(`Found ${dupes.length} duplicate row(s) in fof_underlying_detail:`)
  for (const d of dupes) {
    console.log(`  id=${d.id}  fof="${d.fof_fund_name}"  product="${d.product_name}"`)
  }

  if (dupes.length === 0) { process.exit(0) }

  const ids = dupes.map((d) => d.id)
  await query(`DELETE FROM fof_underlying_detail WHERE id = ANY($1::int[])`, [ids])
  console.log(`\nDeleted ${ids.length} duplicate row(s).`)

  process.exit(0)
}
main().catch(e => { console.error(e.message); process.exit(1) })
