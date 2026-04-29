import pg from 'pg'
const { Client } = pg
const c = new Client({ host:'127.0.0.1', port:5433, user:'market_user', password:'2026SmartDashboard!', database:'market_data' })
await c.connect()

// Check the actual date format returned
const r1 = await c.query(`SELECT settlement_date, settlement_date::text AS dt_text, pg_typeof(settlement_date) AS coltype FROM guosen_position_detail LIMIT 1`)
console.log('Date format test:', r1.rows[0])

// Replicate the position-change-detail query for guosen
const today = '2026-04-23'
const yesterday = '2026-04-22'
const r2 = await c.query(`
  SELECT
    UPPER(TRIM(instrument)) AS contract,
    settlement_date::text   AS date,
    SUM(CASE WHEN bs='买' THEN COALESCE(position_lots,0) * COALESCE(settl_today,0)
             ELSE -COALESCE(position_lots,0) * COALESCE(settl_today,0) END)::text AS signed_mv,
    SUM(CASE WHEN bs='买' THEN COALESCE(position_lots,0)
             ELSE -COALESCE(position_lots,0) END)::text AS net_lots
  FROM guosen_position_detail
  WHERE settlement_date IN ($1::date, $2::date)
  GROUP BY UPPER(TRIM(instrument)), settlement_date
  ORDER BY contract
  LIMIT 10
`, [today, yesterday])
console.log('\nGuosen position-change-detail query results:')
r2.rows.forEach(r => console.log(JSON.stringify(r)))

// Check if date comparison would work
console.log('\nDate comparison check:')
console.log(`today = "${today}", r.date type would be:`, r2.rows[0]?.date, JSON.stringify(r2.rows[0]?.date))
console.log('Match?', r2.rows[0]?.date === today)

await c.end()
