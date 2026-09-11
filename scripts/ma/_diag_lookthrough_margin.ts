import { loadProjectEnvFiles } from "@/lib/server/load-project-env"
loadProjectEnvFiles()

async function main() {
  const { query } = await import("@/lib/db")
  const records = await query(
    `SELECT DISTINCT ON (COALESCE(product_code, fund_name))
       id::text, product_code, fund_name, valuation_date::text, net_asset_value::text
     FROM ops_email_valuation_records
     WHERE product_code IN ('SQX078', 'SAZH88')
        OR fund_name ILIKE '%特夫郁金香全量化%'
        OR fund_name ILIKE '%金时信星际风云%'
     ORDER BY COALESCE(product_code, fund_name), valuation_date DESC, id DESC`,
  )
  console.log("records", JSON.stringify(records, null, 2))
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
