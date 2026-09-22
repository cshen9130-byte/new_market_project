/**
 * Self-match test: pick products with different NAV spans, download the
 * product-page NAV CSV (same columns as the UI export), then upload it to
 * similar-fund with no product name and check whether the fund is #1.
 *
 * Usage: node scripts/test-similar-fund-selfmatch.mjs
 * Optional: BASE=http://localhost:3000 node scripts/test-similar-fund-selfmatch.mjs
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, "..")
const BASE = process.env.BASE || "http://localhost:3000"
const OUT_DIR = path.join(root, "data", "similar-fund-selfmatch", process.env.ROUND || "round6")

function loadEnv() {
  for (const fname of [".env.local", ".env"]) {
    const fp = path.join(root, fname)
    if (!fs.existsSync(fp)) continue
    for (const line of fs.readFileSync(fp, "utf8").split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith("#") || !t.includes("=")) continue
      const eq = t.indexOf("=")
      const key = t.slice(0, eq).trim()
      let value = t.slice(eq + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (key && process.env[key] === undefined) process.env[key] = value
    }
  }
}

function makePool() {
  const url = process.env.DATABASE_URL
  if (url) return new pg.Pool({ connectionString: url })
  return new pg.Pool({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    database: process.env.DB_NAME || "market_data",
    user: process.env.DB_USER || "market_user",
    password: process.env.DB_PASSWORD || "",
  })
}

const BUCKETS = [
  { id: "1m", label: "约1个月", minDays: 14, maxDays: 50 },
  { id: "2m", label: "约2个月", minDays: 51, maxDays: 80 },
  { id: "3m", label: "约3个月", minDays: 81, maxDays: 130 },
  { id: "4m", label: "约4个月", minDays: 131, maxDays: 170 },
  { id: "6m", label: "约6个月", minDays: 171, maxDays: 230 },
  { id: "9m", label: "约9个月", minDays: 240, maxDays: 310 },
  { id: "1y", label: "约1年", minDays: 320, maxDays: 430 },
  { id: "15m", label: "约15个月", minDays: 440, maxDays: 540 },
  { id: "18m", label: "约18个月", minDays: 550, maxDays: 680 },
  { id: "2y", label: "约2年", minDays: 690, maxDays: 900 },
]

const EXCLUDE_BEIAN = [
  "SAFP31", "STX591", "SBDS49", "SBPX74", "SBDR72", "ZU231C",
  "SCV735", "APB36B", "ZX697A", "VQ366B", "NP688C",
  "SCV725",
  "SCY504", "SBUB04", "SBNB05", "SBNB02", "SBNB06", "SBKJ11", "S6631D", "VX843A",
  "SEC272", "SAUN55", "SBDP11", "AZK64B", "SBPM16", "SAWP66", "SBDK61", "TW065C", "AQN44A", "SANQ03",
  "SEM403", "SLA149", "SBSF08", "BTD32B", "VX327A", "SBHF11", "AMQ76B", "SAVG87", "SARB00", "SAJS57",
  "VW787B", "SVW787",
  "SEJ748", "EJ748B",
  "NB353A", "SBPR99", "BGZ81C", "SALL46", "SBBB12",
]

async function pickFunds(pool) {
  const picked = []
  const used = new Set(EXCLUDE_BEIAN)
  const only = (process.env.ONLY || "").split(",").map((s) => s.trim()).filter(Boolean)
  const buckets = only.length ? BUCKETS.filter((b) => only.includes(b.id)) : BUCKETS
  for (const bucket of buckets) {
    const { rows } = await pool.query(
      bucket.id === "1m"
        ? `SELECT i.beian_hao, i.product_name,
                  i.inception_date::text AS first_dt,
                  i.latest_nav_date::text AS last_dt,
                  (i.latest_nav_date - i.inception_date)::int AS span_days,
                  0 AS cnt
           FROM private_fund_info i
           WHERE i.product_name IS NOT NULL AND BTRIM(i.product_name) <> ''
             AND i.inception_date IS NOT NULL
             AND i.latest_nav_date >= CURRENT_DATE - INTERVAL '60 days'
             AND (i.latest_nav_date - i.inception_date) BETWEEN $1 AND $2
             AND NOT (UPPER(BTRIM(i.beian_hao)) = ANY($3::text[]))
           ORDER BY random()
           LIMIT 20`
        : `WITH spans AS (
             SELECT UPPER(BTRIM(beian_hao)) AS beian_hao,
                    MIN(price_date)::text AS first_dt,
                    MAX(price_date)::text AS last_dt,
                    COUNT(*)::int AS cnt,
                    (MAX(price_date) - MIN(price_date))::int AS span_days
             FROM private_fund_nav
             WHERE nav IS NOT NULL AND nav > 0
               AND price_date >= CURRENT_DATE - INTERVAL '4 years'
             GROUP BY 1
             HAVING COUNT(*) >= 4
               AND (MAX(price_date) - MIN(price_date)) BETWEEN $1 AND $2
               AND MAX(price_date) >= CURRENT_DATE - INTERVAL '90 days'
           )
           SELECT i.beian_hao, i.product_name, s.cnt, s.first_dt, s.last_dt, s.span_days
           FROM spans s
           JOIN private_fund_info i ON UPPER(BTRIM(i.beian_hao)) = s.beian_hao
           WHERE i.product_name IS NOT NULL AND BTRIM(i.product_name) <> ''
             AND NOT (UPPER(BTRIM(i.beian_hao)) = ANY($3::text[]))
           ORDER BY random()
           LIMIT 20`,
      [bucket.minDays, bucket.maxDays, [...used]],
    )
    if (!rows.length) throw new Error(`No fund found for bucket ${bucket.id} (${bucket.label})`)

    const tried = []
    for (const row of rows) {
      try {
        const detail = await downloadProductNav(row.beian_hao)
        if (detail.series.length < 4) continue
        const first = detail.series[0].price_date
        const last = detail.series[detail.series.length - 1].price_date
        const span = Math.round((Date.parse(last) - Date.parse(first)) / 86_400_000)
        const cand = {
          ...row,
          bucket,
          product_name: detail.productName || row.product_name,
          first_dt: first,
          last_dt: last,
          span_days: span,
          cnt: detail.series.length,
          pageSeries: detail.series,
        }
        if (/明汯宏观招享3号/.test(cand.product_name)) {
          console.log(`  skip ${cand.beian_hao}: identical-NAV 期 sibling family`)
          continue
        }
        const twin = await findIdenticalShareClassTwin(cand.beian_hao, cand.pageSeries)
        if (twin) {
          console.log(`  skip ${cand.beian_hao}: identical product-page NAV as ${twin}`)
          continue
        }
        const mid = (bucket.minDays + bucket.maxDays) / 2
        tried.push(cand)
        console.log(`  try [${bucket.id}] ${cand.product_name} (${cand.beian_hao}) page ${cand.cnt}pts ${first}~${last} (${span}d)`)
        if (span >= bucket.minDays && span <= bucket.maxDays) {
          picked.push(cand)
          used.add(String(cand.beian_hao).trim().toUpperCase())
          break
        }
        void mid
      } catch (err) {
        console.log(`  skip ${row.beian_hao}: ${err.message}`)
      }
    }
    if (picked[picked.length - 1]?.bucket.id !== bucket.id) {
      if (!tried.length) throw new Error(`No fund found for bucket ${bucket.id} (${bucket.label})`)
      const mid = (bucket.minDays + bucket.maxDays) / 2
      tried.sort((a, b) => Math.abs(a.span_days - mid) - Math.abs(b.span_days - mid))
      const cand = tried[0]
      console.log(`  fallback [${bucket.id}] ${cand.product_name} (${cand.beian_hao}) page span ${cand.span_days}d`)
      picked.push(cand)
      used.add(String(cand.beian_hao).trim().toUpperCase())
    }
  }
  return picked
}

function csvFromNavSeries(series) {
  const escape = (v) => {
    if (v == null || v === "") return ""
    const s = String(v)
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s
  }
  const headers = ["日期", "单位净值", "累计净值", "复权净值", "涨跌幅"]
  const lines = [headers.join(",")]
  for (const r of series) {
    lines.push([
      escape(r.price_date),
      escape(r.nav),
      escape(r.cum_nav_withdrawal),
      escape(r.cumulative_nav),
      "",
    ].join(","))
  }
  return `\uFEFF${lines.join("\n")}`
}

function seriesFingerprint(series) {
  return series.map((r) => `${String(r.price_date).slice(0, 10)}:${Number(r.nav)}`).join("|")
}

function shareClassSiblingCodes(beian) {
  const u = String(beian || "").trim().toUpperCase()
  if (!u) return []
  let base = u.replace(/[ABC]$/u, "")
  if (base.startsWith("S") && base.length > 5) base = base.slice(1)
  const out = new Set()
  for (const stem of [base, `S${base}`]) {
    out.add(stem)
    for (const letter of ["A", "B", "C"]) out.add(`${stem}${letter}`)
  }
  out.delete(u)
  return [...out]
}

async function findIdenticalShareClassTwin(beian, series) {
  const self = seriesFingerprint(series)
  if (!self) return null
  for (const sib of shareClassSiblingCodes(beian)) {
    try {
      const detail = await downloadProductNav(sib)
      if (detail.series.length === series.length && seriesFingerprint(detail.series) === self) {
        return `${sib}`
      }
    } catch {
      /* no page */
    }
  }
  return null
}

async function downloadProductNav(beian) {
  const res = await fetch(`${BASE}/ma/api/private-funds/${encodeURIComponent(beian)}`, {
    headers: { Accept: "application/json" },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`product page ${beian} HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  const body = await res.json()
  const series = Array.isArray(body.nav_series) ? body.nav_series : []
  if (series.length < 4) {
    throw new Error(`product page ${beian} returned only ${series.length} nav points`)
  }
  return {
    productName: body.info?.product_name || "",
    series,
  }
}

async function runSimilarFund(csvBuffer, filename) {
  const form = new FormData()
  form.set("subject", "")
  form.set("namedFund", "0")
  form.set("fileNote", "")
  form.set("matchOnly", "1")
  form.set("files", new Blob([csvBuffer], { type: "text/csv" }), filename)

  const res = await fetch(`${BASE}/ma/api/ai-researcher/similar-fund`, {
    method: "POST",
    body: form,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`similar-fund HTTP ${res.status}: ${text.slice(0, 300)}`)
  }

  const events = []
  let matches = []
  let buf = ""
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const parts = buf.split("\n\n")
    buf = parts.pop() || ""
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data: "))
      if (!line) continue
      try {
        const ev = JSON.parse(line.slice(6))
        events.push(ev)
        if (ev.type === "matches" && Array.isArray(ev.items)) matches = ev.items
        if (ev.type === "done" || ev.type === "error") {
          try { await reader.cancel() } catch { /* ignore */ }
          return { matches, events, error: ev.type === "error" ? ev.message : null }
        }
      } catch {
        /* skip malformed */
      }
    }
  }
  return { matches, events, error: null }
}

function rankOf(matches, beian, name) {
  const key = String(beian || "").trim().toUpperCase()
  const nameKey = String(name || "").trim()
  const idx = matches.findIndex((m) => {
    if (String(m.beian_hao || "").trim().toUpperCase() === key) return true
    return nameKey && String(m.product_name || "").trim() === nameKey
  })
  return idx < 0 ? null : idx + 1
}

async function main() {
  loadEnv()
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const pool = makePool()
  try {
    const rerunArgs = process.argv.slice(2)
    let funds
    if (rerunArgs.length) {
      funds = rerunArgs.map((arg) => {
        const base = path.basename(arg).replace(/\.csv$/i, "")
        const [bucketId, beian] = base.split("-")
        const bucket = BUCKETS.find((b) => b.id === bucketId) || { id: bucketId || "rerun", label: bucketId || "rerun" }
        return { beian_hao: beian, product_name: beian, first_dt: "", last_dt: "", span_days: 0, cnt: 0, bucket, csvFile: path.isAbsolute(arg) ? arg : path.join(OUT_DIR, path.basename(arg)) }
      })
      console.log("Re-running saved CSVs:", funds.map((f) => f.csvFile).join(", "))
    } else {
      console.log("Picking funds with different NAV spans...")
      funds = await pickFunds(pool)
      for (const f of funds) {
        console.log(`  [${f.bucket.id}] ${f.product_name} (${f.beian_hao}) ${f.first_dt} ~ ${f.last_dt}  ${f.span_days}d / ${f.cnt} pts`)
      }
    }

    const results = []
    for (const f of funds) {
      console.log(`\n=== ${f.bucket.label} ${f.beian_hao} ${f.product_name} ===`)
      let csv
      let uploadedPoints = 0
      if (f.csvFile && fs.existsSync(f.csvFile)) {
        csv = fs.readFileSync(f.csvFile)
        uploadedPoints = csv.toString("utf8").trim().split(/\r?\n/).length - 1
        console.log(`  reuse csv: ${f.csvFile} (${uploadedPoints} pts)`)
      } else {
        const series = f.pageSeries || (await downloadProductNav(f.beian_hao)).series
        if (!f.product_name || f.product_name === f.beian_hao) {
          try {
            const detail = f.pageSeries ? { productName: f.product_name, series } : await downloadProductNav(f.beian_hao)
            f.product_name = detail.productName || f.product_name
          } catch { /* keep name */ }
        }
        const first = series[0].price_date
        const last = series[series.length - 1].price_date
        console.log(`  product-page nav: ${series.length} pts  ${first} ~ ${last}`)
        csv = Buffer.from(csvFromNavSeries(series), "utf8")
        uploadedPoints = series.length
        const csvPath = path.join(OUT_DIR, `${f.bucket.id}-${f.beian_hao}.csv`)
        fs.writeFileSync(csvPath, csv)
      }
      const { matches, events, error } = await runSimilarFund(csv, "净值.csv")
      const step3 = events.find((e) => e.type === "step_done" && e.step === 3)
      if (step3) console.log(`  step3: ${step3.summary}`)
      if (error) console.log(`  error: ${error}`)
      const rank = rankOf(matches, f.beian_hao, f.product_name)
      const top = matches[0]
      console.log(`  top: ${top ? `${top.product_name} (${top.beian_hao}) corr=${top.correlation}` : "(none)"}`)
      console.log(`  self rank: ${rank ?? "NOT FOUND"}`)
      results.push({
        bucket: f.bucket.id,
        label: f.bucket.label,
        beian_hao: f.beian_hao,
        product_name: f.product_name,
        span_days: f.span_days,
        uploaded_points: uploadedPoints,
        rank,
        top: top || null,
        pass: rank === 1,
      })
    }

    const outFile = path.join(OUT_DIR, "results.json")
    fs.writeFileSync(outFile, JSON.stringify(results, null, 2))
    console.log("\n======== SUMMARY ========")
    for (const r of results) {
      console.log(`${r.pass ? "PASS" : "FAIL"}  [${r.bucket}] ${r.product_name} (${r.beian_hao}) rank=${r.rank ?? "miss"} top=${r.top ? `${r.top.product_name} ${r.top.correlation}` : "none"}`)
    }
    const failed = results.filter((r) => !r.pass)
    if (failed.length) {
      console.log(`\n${failed.length} failed`)
      process.exitCode = 1
    } else {
      console.log(`\nAll ${results.length} self-matched`)
    }
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
