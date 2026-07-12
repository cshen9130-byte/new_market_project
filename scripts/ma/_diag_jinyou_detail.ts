import pg from "pg"

const DB =
  "postgresql://market_user:2026SmartDashboard%21@127.0.0.1:5433/market_data"

async function main() {
  const p = new pg.Pool({ connectionString: DB })

  const bad = await p.query(`
    SELECT id, nav_date::text, nav::text, product_code, fund_name,
           left(subject,120) subj, left(attachment_filename,80) att, source
    FROM ops_email_nav_records
    WHERE product_code = 'SXN097'
    ORDER BY nav_date DESC`)
  console.log("SXN097 rows:", bad.rows)

  const managed = await p.query(`
    SELECT m.id, m.product_name, cache.beian_hao, cache.nav_date::text, cache.unit_nav::text
    FROM managed_products m
    LEFT JOIN ops_managed_products_list_cache cache ON cache.managed_product_id = m.id
    WHERE m.product_name ILIKE '%金舆%' OR m.product_name ILIKE '%古曲祥辰5%'
    ORDER BY m.product_name`)
  console.log("\nmanaged_products:", managed.rows)

  const fd = await p.query(`
    SELECT beian_hao, product_name FROM fof_underlying_detail
    WHERE product_name ILIKE '%金舆基石%' OR beian_hao IN ('SXN097','SAVW72')
    LIMIT 20`)
  console.log("\nfof_underlying_detail:", fd.rows)

  const track = await p.query(`
    SELECT beian_hao, product_name FROM investment_tracking_fof_underlying
    WHERE product_name ILIKE '%金舆基石%' OR beian_hao IN ('SXN097','SAVW72')
    LIMIT 20`)
  console.log("\ntracking_fof:", track.rows)

  const bfl = await p.query(`
    SELECT beian_hao, product_name, short_name FROM private_fund_info_bfl
    WHERE beian_hao IN ('SAVW72','SXN097') OR product_name ILIKE '%金舆基石%'`)
  console.log("\nbfl:", bfl.rows)

  const savw = await p.query(`
    SELECT nav_date::text, nav::text, product_code, fund_name
    FROM ops_email_nav_records WHERE product_code = 'SAVW72'
    ORDER BY nav_date DESC LIMIT 3`)
  console.log("SAVW72 recent:", savw.rows)

  await p.end()
}

main().catch(console.error)
