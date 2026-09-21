require("dotenv").config({ path: ".env.local" })
const { Client } = require("pg")

const client = new Client(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.DB_HOST || "localhost",
        port: Number(process.env.DB_PORT || 5432),
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
      },
)

async function main() {
  await client.connect()
  const recs = await client.query(`
    SELECT id, product_code, fund_name, valuation_date::text,
           net_asset_value, attachment_filename, holdings_count,
           crawl_email_account, email_uid
    FROM ops_email_valuation_records
    WHERE fund_name ILIKE '%慕途基本面%' OR fund_name ILIKE '%慕途%量化%'
    ORDER BY valuation_date DESC, id DESC
    LIMIT 8
  `)
  console.log(JSON.stringify(recs.rows, null, 2))
  const id = recs.rows[0]?.id
  if (!id) return
  const h = await client.query(
    `
    SELECT subject_code, subject_name, row_kind, include_in_detail, is_leaf,
           market_value, cost, quantity
    FROM ops_email_valuation_holdings
    WHERE valuation_record_id = $1
      AND (
        subject_code LIKE '3102%'
        OR row_kind IN ('derivative', 'option')
        OR subject_name ~ '期货|合约|互换|衍生'
      )
    ORDER BY ABS(COALESCE(market_value,0)) DESC
    LIMIT 80
    `,
    [id],
  )
  console.log("=== holdings", h.rows.length, "===")
  for (const r of h.rows) {
    console.log(
      [r.include_in_detail ? "Y" : "N", r.row_kind, r.subject_code, r.subject_name,
        Number(r.market_value || 0).toFixed(2)].join(" | "),
    )
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => client.end())
