import pg from 'pg'
const { Client } = pg
const c = new Client({ host:'127.0.0.1', port:5433, user:'market_user', password:'2026SmartDashboard!', database:'market_data' })
await c.connect()
const r1 = await c.query('SELECT MAX(settlement_date)::text AS d FROM guosen_position_detail')
console.log('max guosen date:', r1.rows[0].d)
const r2 = await c.query(`SELECT DISTINCT "交易日期"::date::text AS d FROM mom_position_details WHERE "交易日期" IS NOT NULL ORDER BY d DESC LIMIT 3`)
console.log('mom latest dates:', r2.rows.map(r => r.d))
const latest = r2.rows[0]?.d
if (latest) {
  const r3 = await c.query('SELECT COUNT(*) FROM guosen_position_detail WHERE settlement_date::date = $1', [latest])
  console.log(`guosen rows for MOM date ${latest}:`, r3.rows[0].count)
  const r4 = await c.query(`SELECT instrument, bs, position_lots, settl_today FROM guosen_position_detail WHERE settlement_date::date = $1 LIMIT 5`, [latest])
  console.log('sample guosen rows:', r4.rows)
}
await c.end()
