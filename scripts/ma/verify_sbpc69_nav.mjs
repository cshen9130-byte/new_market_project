import { loadProjectEnvFiles } from "../../lib/server/load-project-env.ts"
import { query } from "../../lib/db.ts"

loadProjectEnvFiles()

const nav = await query(
  `SELECT nav_date::text, nav::text, source, left(subject, 60) AS subject, attachment_filename
   FROM ops_email_nav_records
   WHERE product_code = 'SBPC69' OR subject ILIKE '%SBPC69%'
   ORDER BY nav_date DESC
   LIMIT 8`,
)

const val = await query(
  `SELECT valuation_date::text, unit_nav::text, left(subject, 60) AS subject, attachment_filename
   FROM ops_email_valuation_records
   WHERE product_code = 'SBPC69' OR subject ILIKE '%SBPC69%'
   ORDER BY valuation_date DESC
   LIMIT 8`,
)

console.log("NAV records:")
for (const r of nav) console.log(`  ${r.nav_date} nav=${r.nav} subj=${r.subject}`)

console.log("\nValuation records:")
for (const r of val) console.log(`  ${r.valuation_date} unit=${r.unit_nav} subj=${r.subject}`)
