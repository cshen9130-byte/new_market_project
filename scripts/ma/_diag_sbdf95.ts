import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import {
  isNavTableSubject,
  isNavTableAttachmentFilename,
  selectNavTableAttachments,
} from "../../lib/server/email-nav-attachment"
import { extractNavMetadata } from "../../lib/server/email-nav-extract"

loadProjectEnvFiles()

const subject =
  "【基金净值】SBDF95(总)_锐耐稳健对冲11号私募证券投资基金_20250808-20260702"
const filename =
  "【基金净值】锐耐稳健对冲11号私募证券投资基金(总)_20250808-20260702.xlsx"

async function main() {
  console.log("=== attachment selection (before fix) ===")
  console.log("isNavTableSubject:", isNavTableSubject(subject))
  console.log("isNavTableAttachmentFilename:", isNavTableAttachmentFilename(filename))
  console.log(
    "selectNavTableAttachments:",
    selectNavTableAttachments(subject, [{ filename, part: "1" }]),
  )
  console.log("extractNavMetadata:", extractNavMetadata(subject, filename))

  const nav = await query<{ n: string }>(
    `SELECT count(*)::text AS n
     FROM ops_email_nav_records
     WHERE product_code = 'SBDF95'
        OR subject ILIKE '%SBDF95%'
        OR fund_name ILIKE '%锐耐%'
        OR attachment_filename ILIKE '%锐耐%'`,
  )

  const parse = await query<{
    subj: string | null
    att: string | null
    nav_parse_status: string | null
    nav_saved_count: number | null
  }>(
    `SELECT left(subject, 100) AS subj,
            left(attachment_filename, 80) AS att,
            nav_parse_status,
            nav_saved_count
     FROM ops_email_parse_records
     WHERE subject ILIKE '%SBDF95%' OR subject ILIKE '%锐耐稳健%'
     ORDER BY sent_at DESC
     LIMIT 5`,
  )

  const pool = await query<{ register_number: string; product_name: string }>(
    `SELECT register_number, product_name
     FROM user_custom_pool
     WHERE pool_key = 'custom_email_nav'
       AND (register_number = 'SBDF95' OR product_name ILIKE '%锐耐%')`,
  )

  console.log("\n=== database ===")
  console.log("nav rows:", nav[0]?.n)
  console.log("parse records:", parse)
  console.log("pool rows:", pool)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
