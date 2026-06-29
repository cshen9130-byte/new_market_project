import { createRequire } from 'module'
const require = createRequire(import.meta.url)

// Load env manually
import fs from 'fs'
import path from 'path'
const envFile = path.join(process.cwd(), '.env.local')
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#') || !t.includes('=')) continue
    const eq = t.indexOf('=')
    const key = t.slice(0, eq).trim()
    let val = t.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
    if (key && process.env[key] === undefined) process.env[key] = val
  }
}

import pg from 'pg'
const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()

const res = await client.query(`
  SELECT nav_date::date AS date, nav, cumulative_nav, adjusted_nav, source, subject
  FROM ops_email_nav_records
  WHERE fund_name LIKE '%小天鹅2%'
    AND nav_date >= '2026-06-15'
  ORDER BY nav_date
`)
console.log('Email records for 百奕小天鹅2号 since Jun 15:')
for (const r of res.rows) {
  console.log(r.date, '| unit:', r.nav, '| cum:', r.cumulative_nav, '| adj:', r.adjusted_nav, '| src:', r.source)
}

await client.end()
