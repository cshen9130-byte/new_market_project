import pg from 'pg'
const { Pool } = pg

const pool = new Pool({ connectionString: 'postgresql://market_user:2026SmartDashboard!@127.0.0.1:5433/market_data' })

try {
  // 1. 检查两张表存在
  const tables = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_name IN ('raw_nhci_daily','raw_akshare_futures_daily') ORDER BY 1"
  )
  console.log('Tables found:', tables.rows.map(r => r.table_name))

  // 2. nhci 最新5条
  try {
    const nhci = await pool.query('SELECT trade_date, close FROM raw_nhci_daily ORDER BY trade_date DESC LIMIT 5')
    console.log('nhci sample:', nhci.rows)
  } catch(e) { console.log('nhci error:', e.message) }

  // 3. futures 最新5条
  try {
    const fut = await pool.query('SELECT trade_date, code, close FROM raw_akshare_futures_daily ORDER BY trade_date DESC LIMIT 5')
    console.log('futures sample:', fut.rows)
  } catch(e) { console.log('futures error:', e.message) }

  // 4. 近120天 nhci 行数
  const since = new Date(); since.setDate(since.getDate()-120)
  const sinceStr = since.toISOString().slice(0,10)
  try {
    const c1 = await pool.query('SELECT COUNT(*) FROM raw_nhci_daily WHERE trade_date >= $1 AND close IS NOT NULL AND close::numeric > 0', [sinceStr])
    console.log('nhci rows 120d:', c1.rows[0].count)
  } catch(e) { console.log('nhci count error:', e.message) }

  // 5. 近120天 futures 行数
  try {
    const c2 = await pool.query('SELECT COUNT(*) FROM raw_akshare_futures_daily WHERE trade_date >= $1 AND close IS NOT NULL AND close::numeric > 0', [sinceStr])
    console.log('futures rows 120d:', c2.rows[0].count)
    // 品种数
    const c3 = await pool.query('SELECT COUNT(DISTINCT code) FROM raw_akshare_futures_daily WHERE trade_date >= $1', [sinceStr])
    console.log('distinct codes 120d:', c3.rows[0].count)
    // 样本codes
    const c4 = await pool.query('SELECT DISTINCT code FROM raw_akshare_futures_daily ORDER BY 1 LIMIT 10')
    console.log('sample codes:', c4.rows.map(r=>r.code))
  } catch(e) { console.log('futures count error:', e.message) }

} catch(e) {
  console.error('Connection error:', e.message)
} finally {
  await pool.end()
}
