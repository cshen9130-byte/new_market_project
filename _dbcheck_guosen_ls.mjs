import pg from 'pg'
const { Client } = pg
const c = new Client({ connectionString: 'postgresql://market_user:2026SmartDashboard!@127.0.0.1:5433/market_data' })
await c.connect()
const r = await c.query(`SELECT bs, SUM(margin) as total FROM guosen_position_detail WHERE settlement_date=(SELECT MAX(settlement_date) FROM guosen_position_detail) GROUP BY bs`)
console.log('bs groups:', JSON.stringify(r.rows))
const r2 = await c.query(`SELECT SUM(CASE WHEN bs='买' THEN COALESCE(margin,0) ELSE 0 END) AS long_margin, SUM(CASE WHEN bs='卖' THEN COALESCE(margin,0) ELSE 0 END) AS short_margin FROM guosen_position_detail WHERE settlement_date=(SELECT MAX(settlement_date) FROM guosen_position_detail)`)
console.log('ls split:', JSON.stringify(r2.rows))
await c.end()
