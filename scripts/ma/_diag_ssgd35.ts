import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"

loadProjectEnvFiles()

const code = "SSGD35"
const name = "奇盾抱朴"

async function main() {
  const nav = await query<{
    nav_date: string
    nav: string
    source: string | null
    subj: string | null
    att: string | null
  }>(
    `SELECT nav_date::text, nav::text, source, left(subject,80) subj, left(attachment_filename,60) att
     FROM ops_email_nav_records
     WHERE product_code = $1 OR subject ILIKE '%' || $1 || '%' OR attachment_filename ILIKE '%' || $1 || '%'
     ORDER BY nav_date DESC LIMIT 20`,
    [code],
  )

  const val = await query<{
    valuation_date: string
    unit_nav: string | null
    cumulative_nav: string | null
    product_code: string | null
    fn: string | null
    subj: string | null
  }>(
    `SELECT valuation_date::text, unit_nav::text, cumulative_nav::text, product_code,
            left(fund_name,40) fn, left(subject,80) subj
     FROM ops_email_valuation_records
     WHERE product_code = $1 OR fund_name ILIKE '%' || $2 || '%' OR subject ILIKE '%' || $1 || '%'
     ORDER BY valuation_date DESC LIMIT 20`,
    [code, name],
  )

  const fof = await query<{
    valuation_date: string
    price: string | null
    quantity: string | null
    market_value: string | null
    underlying_product_code: string | null
    underlying_name: string
  }>(
    `SELECT valuation_date::text, price::text, quantity::text, market_value::text,
            underlying_product_code, underlying_name
     FROM ops_managed_fof_underlying
     WHERE underlying_product_code = $1 OR underlying_name ILIKE '%' || $2 || '%'
     ORDER BY valuation_date DESC LIMIT 10`,
    [code, name],
  )

  const cache = await query(
    `SELECT unit_nav, nav_date, return_pct, ret_1w, ret_1m, ret_3m
     FROM ops_fof_overview_list_cache c
     JOIN fof_underlying_summary f ON f.id = c.fof_underlying_id
     WHERE f.product_name ILIKE '%' || $1 || '%'`,
    [name],
  )

  const summary = await query(
    `SELECT id::text, product_name, latest_unit_nav::text, latest_nav_date::text
     FROM fof_underlying_summary
     WHERE product_name ILIKE '%' || $1 || '%' OR product_name ILIKE '%抱朴专享%'`,
    [name],
  )

  const valByName = await query(
    `SELECT valuation_date::text, unit_nav::text, product_code, left(fund_name, 50) AS fn
     FROM ops_email_valuation_records
     WHERE subject ILIKE '%奇盾%' OR fund_name ILIKE '%奇盾%' OR attachment_filename ILIKE '%SSGD35%'
     ORDER BY valuation_date DESC LIMIT 15`,
  )

  const navByName = await query(
    `SELECT nav_date::text, nav::text, product_code, source, left(subject, 70) AS subj
     FROM ops_email_nav_records
     WHERE subject ILIKE '%奇盾%' OR fund_name ILIKE '%奇盾%' OR attachment_filename ILIKE '%SSGD35%'
     ORDER BY nav_date DESC LIMIT 15`,
  )

  const valSsgd = await query(
    `SELECT valuation_date::text, unit_nav::text, product_code, left(fund_name, 60) AS fn
     FROM ops_email_valuation_records
     WHERE subject ILIKE '%SSGD%' OR attachment_filename ILIKE '%SSGD%'
        OR fund_name ILIKE '%抱朴专享%' OR product_code ILIKE '%SSGD%'
     ORDER BY valuation_date DESC LIMIT 20`,
  )

  const legacy = await query(
    `SELECT price_date::text, nav::text, beian_hao, product_name
     FROM private_fund_nav
     WHERE beian_hao ILIKE '%SSGD%' OR product_name ILIKE '%抱朴专享%'
     ORDER BY price_date DESC LIMIT 10`,
  )

  const type6 = await query(
    `SELECT price_date::text, nav::text, beian_hao, product_name
     FROM private_fund_nav_group_type6
     WHERE beian_hao ILIKE '%SSGD%' OR product_name ILIKE '%抱朴专享%'
     ORDER BY price_date DESC LIMIT 10`,
  )

  const beian = await query(
    `SELECT f.product_name, f.market_value::text,
            b.beian_hao AS bfl_beian,
            pi.beian_hao AS pinfo_beian
     FROM fof_underlying_summary f
     LEFT JOIN private_fund_info_bfl b ON b.product_name = f.product_name
     LEFT JOIN private_fund_info pi ON pi.product_name = f.product_name
     WHERE f.product_name ILIKE '%抱朴专享%'`,
  )

  console.log("=== fof_underlying_summary ===", summary)
  console.log("=== ops_email_nav_records (code) ===", nav.length)
  for (const r of nav) console.log(r)
  console.log("=== ops_email_nav_records (name) ===", navByName.length)
  for (const r of navByName) console.log(r)
  console.log("=== ops_email_valuation_records (code) ===", val.length)
  for (const r of val) console.log(r)
  console.log("=== ops_email_valuation_records (name) ===", valByName.length)
  for (const r of valByName) console.log(r)
  console.log("=== ops_email_valuation_records (SSGD/抱朴专享) ===", valSsgd.length)
  for (const r of valSsgd) console.log(r)
  console.log("=== private_fund_nav legacy ===", legacy)
  console.log("=== type6 nav ===", type6)
  console.log("=== beian / market_value ===", beian)
  console.log("=== ops_managed_fof_underlying ===", fof.length)
  for (const r of fof) console.log(r)
  console.log("=== cache ===", cache)
}

main().catch(console.error)
