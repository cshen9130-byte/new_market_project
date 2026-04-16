import pg from 'pg'
const pool = new pg.Pool({ connectionString: 'postgresql://market_user:2026SmartDashboard!@127.0.0.1:5433/market_data' })

const r = await pool.query(`
  SELECT
    fp."\u8d26\u6237"                AS account,
    fp."\u4ea4\u6613\u65e5\u671f"::date::text AS date,
    SUM(CASE WHEN (NULLIF(REPLACE(fp."\u4e70\u6301\u4ed3", ',', ''), ''))::numeric > 0
          THEN (NULLIF(REPLACE(REPLACE(fp."\u4fdd\u8bc1\u91d1", ',', ''), ' ', ''), ''))::numeric ELSE 0 END) AS long_margin,
    SUM(CASE WHEN (NULLIF(REPLACE(fp."\u5356\u6301\u4ed3", ',', ''), ''))::numeric > 0
          THEN (NULLIF(REPLACE(REPLACE(fp."\u4fdd\u8bc1\u91d1", ',', ''), ' ', ''), ''))::numeric ELSE 0 END) AS short_margin
  FROM mom_futures_position_details fp
  WHERE fp."\u4ea4\u6613\u65e5\u671f"::date = (SELECT MAX("\u4ea4\u6613\u65e5\u671f"::date) FROM mom_futures_position_details)
  GROUP BY fp."\u8d26\u6237", fp."\u4ea4\u6613\u65e5\u671f"::date
  ORDER BY fp."\u8d26\u6237"
  LIMIT 10
`)
console.log('per-account LS latest:', r.rows.map(x => JSON.stringify(x)).join('\n'))

// Check a sample of raw 买持仓/卖持仓 values
const raw = await pool.query(`SELECT "\u8d26\u6237", "\u4e70\u6301\u4ed3", "\u5356\u6301\u4ed3", "\u4fdd\u8bc1\u91d1" FROM mom_futures_position_details WHERE "\u4ea4\u6613\u65e5\u671f"::date = (SELECT MAX("\u4ea4\u6613\u65e5\u671f"::date) FROM mom_futures_position_details) LIMIT 5`)
console.log('\nraw sample:', raw.rows.map(x=>JSON.stringify(x)).join('\n'))

pool.end()
