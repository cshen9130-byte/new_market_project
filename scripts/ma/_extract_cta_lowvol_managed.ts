/**
 * Extract all running 在管产品 for Word report.
 * Usage: npx tsx scripts/ma/_extract_cta_lowvol_managed.ts
 */
import fs from "fs"
import net from "net"
import path from "path"
import { spawn, type ChildProcess } from "child_process"
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

const LOCAL_PORT = 5433
const AS_OF = "2026-08-17"
const OUT_PATH = path.join(process.cwd(), "scripts", "ma", "_cta_lowvol_report_data.json")

async function waitForPort(port: number, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = net.connect(port, "127.0.0.1")
        socket.once("connect", () => { socket.destroy(); resolve() })
        socket.once("error", reject)
      })
      return true
    } catch {
      await new Promise((r) => setTimeout(r, 400))
    }
  }
  return false
}

async function ensureTunnel(): Promise<ChildProcess | null> {
  process.env.DATABASE_URL = `postgresql://market_user:2026SmartDashboard%21@127.0.0.1:${LOCAL_PORT}/market_data`
  if (await waitForPort(LOCAL_PORT, 800)) {
    console.log(`Using existing listener on localhost:${LOCAL_PORT}`)
    return null
  }
  const keyPath = path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".ssh", "id_ed25519_server")
  const child = spawn(
    "ssh",
    ["-i", keyPath, "-L", `${LOCAL_PORT}:127.0.0.1:5432`, "-N", "-o", "StrictHostKeyChecking=accept-new", "-o", "ExitOnForwardFailure=yes", "root@8.154.33.143"],
    { stdio: "ignore", windowsHide: true },
  )
  if (!(await waitForPort(LOCAL_PORT))) {
    child.kill()
    throw new Error("SSH tunnel failed")
  }
  console.log("SSH tunnel ready")
  return child
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null
  const n = typeof v === "number" ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

function pickNav(row: Record<string, unknown>): number | null {
  for (const key of ["cum_nav_withdrawal", "cumulative_nav", "adjusted_nav", "nav"]) {
    const n = num(row[key])
    if (n != null && n > 0) return n
  }
  return null
}

function downsample(points: Array<{ date: string; nav: number }>): Array<{ date: string; nav: number }> {
  if (points.length <= 220) return points
  const out: Array<{ date: string; nav: number }> = []
  const step = Math.ceil(points.length / 180)
  for (let i = 0; i < points.length; i += step) out.push(points[i])
  const last = points[points.length - 1]
  if (out[out.length - 1]?.date !== last.date) out.push(last)
  return out
}

function metricsFromNav(points: Array<{ date: string; nav: number }>, asOf: string, rf = 0.02) {
  const series = points.filter((p) => p.date <= asOf && p.nav > 0)
  if (series.length < 5) {
    return { n: series.length, start_date: series[0]?.date ?? null, end_date: series.at(-1)?.date ?? null, total_return: null, ann_return: null, ann_vol: null, max_dd: null, sharpe: null, calmar: null, ret_ytd: null, ret_1y: null }
  }
  const start = series[0]
  const end = series[series.length - 1]
  const total = end.nav / start.nav - 1
  const days = Math.max(1, (Date.parse(end.date) - Date.parse(start.date)) / 86400000)
  const annReturn = (end.nav / start.nav) ** (365.25 / days) - 1
  const rets: number[] = []
  for (let i = 1; i < series.length; i++) {
    const r = series[i].nav / series[i - 1].nav - 1
    if (Number.isFinite(r)) rets.push(r)
  }
  const mean = rets.reduce((s, x) => s + x, 0) / rets.length
  const variance = rets.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, rets.length - 1)
  const annVol = Math.sqrt(variance) * Math.sqrt(252)
  let peak = series[0].nav
  let maxDd = 0
  for (const p of series) {
    if (p.nav > peak) peak = p.nav
    const dd = p.nav / peak - 1
    if (dd < maxDd) maxDd = dd
  }
  const cutoff1y = new Date(`${end.date}T00:00:00`)
  cutoff1y.setFullYear(cutoff1y.getFullYear() - 1)
  const prior1y = [...series].reverse().find((p) => p.date <= cutoff1y.toISOString().slice(0, 10)) ?? series[0]
  const ytdStart = `${end.date.slice(0, 4)}-01-01`
  const priorYtd = [...series].reverse().find((p) => p.date < ytdStart) ?? series.find((p) => p.date >= ytdStart)
  return {
    n: series.length,
    start_date: start.date,
    end_date: end.date,
    total_return: total,
    ann_return: annReturn,
    ann_vol: annVol,
    max_dd: maxDd,
    sharpe: annVol > 1e-8 ? (annReturn - rf) / annVol : null,
    calmar: Math.abs(maxDd) > 1e-8 ? annReturn / Math.abs(maxDd) : null,
    ret_ytd: priorYtd ? end.nav / priorYtd.nav - 1 : null,
    ret_1y: prior1y ? end.nav / prior1y.nav - 1 : null,
  }
}

function cleanHoldingName(name: string): string {
  return name
    .replace(/^场外[_／/].*?私募[_．.]/g, "")
    .replace(/^场外_已上市_开放式_私募_成本\./, "")
    .replace(/私募证券投资基金/g, "")
    .replace(/私募投资基金/g, "")
    .trim()
}

function extractWindows(text: string, needles: string[], radius = 200): string[] {
  const lower = text.toLowerCase()
  const windows: string[] = []
  for (const p of needles) {
    const needle = p.toLowerCase()
    if (needle.length < 2) continue
    let from = 0
    while (windows.length < 6) {
      const idx = lower.indexOf(needle, from)
      if (idx < 0) break
      const w = text.slice(Math.max(0, idx - radius), Math.min(text.length, idx + needle.length + radius)).replace(/\s+/g, " ").trim()
      if (w && !windows.some((x) => x.includes(w) || w.includes(x))) windows.push(w)
      from = idx + needle.length
    }
  }
  return windows
}

function classifyHolding(name: string): string {
  const n = name
  if (/CTA|期货|商品套利|如川|恒盈/.test(n)) return "CTA/商品"
  if (/对冲|中性|市场中性/.test(n)) return "市场中性/对冲"
  if (/指增|增强|量化|全量化|1000|500|2000/.test(n)) return "量化指增"
  if (/套利/.test(n)) return "套利"
  if (/宏观|配置|全天候/.test(n)) return "宏观/配置"
  if (/债券|固收|货币/.test(n)) return "固收"
  if (/成长|价值|主观|强势|红利/.test(n)) return "股票主观"
  return "其他权益/混合"
}

async function main() {
  const tunnel = await ensureTunnel()
  try {
    const { query } = await import("../../lib/db")

    type CacheRow = {
      managed_product_id: string
      product_name: string
      beian_hao: string | null
      short_name: string | null
      unit_nav: string | null
      nav_date: string | null
      return_pct: string | null
      ret_1w: string | null
      ret_1m: string | null
      ret_3m: string | null
      ret_6m: string | null
      ret_1y: string | null
      sharpe_1y: string | null
      calmar_1y: string | null
      company_strategy_l1: string | null
      company_strategy_l2: string | null
      company_strategy_l3: string | null
      platform_strategy_l1: string | null
      platform_strategy_l2: string | null
      custody_balance: string | null
      net_asset_value: string | null
      sequence_no: string | null
    }

    const products = await query<CacheRow>(
      `SELECT cache.managed_product_id::text, cache.product_name, cache.beian_hao, cache.short_name,
              cache.unit_nav::text, cache.nav_date::text, cache.return_pct::text,
              cache.ret_1w::text, cache.ret_1m::text, cache.ret_3m::text, cache.ret_6m::text, cache.ret_1y::text,
              cache.sharpe_1y::text, cache.calmar_1y::text,
              cache.company_strategy_l1, cache.company_strategy_l2, cache.company_strategy_l3,
              cache.platform_strategy_l1, cache.platform_strategy_l2,
              COALESCE(cache.custody_balance, m.custody_account_balance)::text AS custody_balance,
              COALESCE(cache.net_asset_value, m.net_asset_value)::text AS net_asset_value,
              m.sequence_no::text
       FROM ops_managed_products_list_cache cache
       JOIN managed_products m ON m.id = cache.managed_product_id
       WHERE m.product_name <> '合计'
         AND (COALESCE(cache.net_asset_value, m.net_asset_value) IS NULL
              OR COALESCE(cache.net_asset_value, m.net_asset_value) > 0)
       ORDER BY m.sequence_no NULLS LAST, cache.product_name`,
    )
    console.log(`running products: ${products.length}`)
    const codes = products.map((p) => p.beian_hao).filter((x): x is string => Boolean(x))
    const names = products.map((p) => p.product_name)
    const ids = products.map((p) => p.managed_product_id)

    const pfi = await query<{ beian_hao: string; manager: string | null; inception_date: string | null; product_name: string | null }>(
      `SELECT beian_hao, manager, inception_date::text, product_name FROM private_fund_info WHERE beian_hao = ANY($1::text[])`,
      [codes],
    )
    const pfiMap = new Map(pfi.map((r) => [r.beian_hao, r]))

    const team = await query<{
      register_number: string | null
      fund_short_name: string | null
      company_strategy_one: string | null
      company_strategy_two: string | null
      company_strategy_three: string | null
      platform_strategy_one: string | null
      platform_strategy_two: string | null
    }>(
      `SELECT DISTINCT ON (register_number)
         register_number, fund_short_name,
         company_strategy_one, company_strategy_two, company_strategy_three,
         platform_strategy_one, platform_strategy_two
       FROM type6_ops_team_full
       WHERE register_number = ANY($1::text[]) OR fund_short_name = ANY($2::text[])
       ORDER BY register_number, updated_at DESC NULLS LAST`,
      [codes, names],
    )
    const teamMap = new Map(team.filter((r) => r.register_number).map((r) => [r.register_number as string, r]))

    const track = await query<{
      register_number: string | null
      advisor: string | null
      mandator_name: string | null
      inception_date: string | null
      risk_level: string | null
      fee_manage: string | null
      fee_trust: string | null
      fee_pay: string | null
      open_day: string | null
      closed_period: string | null
    }>(
      `SELECT DISTINCT ON (register_number)
         register_number, advisor, mandator_name, inception_date::text,
         risk_level, fee_manage, fee_trust, fee_pay, open_day, closed_period
       FROM basicinfo_bfl_track
       WHERE register_number = ANY($1::text[])
       ORDER BY register_number, updated_at DESC NULLS LAST, id DESC`,
      [codes],
    ).catch(() => [])
    const trackMap = new Map(track.filter((r) => r.register_number).map((r) => [r.register_number as string, r]))

    const navCache = await query<{ beian_hao: string | null; product_name: string; nav_series: unknown }>(
      `SELECT beian_hao, product_name, nav_series FROM ops_private_fund_detail_nav_cache
       WHERE beian_hao = ANY($1::text[]) OR product_name = ANY($2::text[])`,
      [codes, names],
    )

    const fofHoldings = await query<{
      managed_product_id: string
      fof_product_name: string
      valuation_date: string
      underlying_product_code: string | null
      underlying_name: string
      market_value: string | null
      market_weight: string | null
    }>(
      `SELECT managed_product_id::text, fof_product_name, valuation_date::text,
              underlying_product_code, underlying_name, market_value::text, market_weight::text
       FROM ops_managed_fof_underlying
       WHERE managed_product_id = ANY($1::bigint[])
       ORDER BY managed_product_id, COALESCE(market_value, 0) DESC`,
      [ids],
    )

    const reportProducts = []
    for (const p of products) {
      const code = p.beian_hao || ""
      const info = pfiMap.get(code)
      const el = trackMap.get(code)
      const t6 = teamMap.get(code)
      const cacheNav = navCache.find((n) => (code && n.beian_hao === code) || n.product_name === p.product_name || names.some((nm) => n.product_name?.includes(p.product_name)))
      const rawSeries = Array.isArray(cacheNav?.nav_series) ? (cacheNav!.nav_series as Record<string, unknown>[]) : []
      const navPoints = rawSeries
        .map((row) => {
          const date = String(row.price_date ?? "").slice(0, 10)
          const nav = pickNav(row)
          return date && nav != null ? { date, nav } : null
        })
        .filter((x): x is { date: string; nav: number } => Boolean(x))
        .sort((a, b) => a.date.localeCompare(b.date))
      const holdings = fofHoldings
        .filter((h) => h.managed_product_id === p.managed_product_id)
        .map((h) => {
          const mv = num(h.market_value)
          const rawW = num(h.market_weight)
          const nav = num(p.net_asset_value)
          const w = nav && mv != null ? mv / nav : rawW != null && Math.abs(rawW) > 1.5 ? rawW / 100 : rawW
          return {
            name: cleanHoldingName(h.underlying_name),
            raw_name: h.underlying_name,
            code: h.underlying_product_code,
            valuation_date: h.valuation_date,
            market_value: mv,
            market_weight: w,
            bucket: classifyHolding(h.underlying_name),
          }
        })

      let valHoldings: Array<{ name: string; asset_class: string | null; market_value: number | null; market_weight: number | null; valuation_date: string }> = []
      if (holdings.length === 0) {
        const rows = await query<{
          subject_name: string
          asset_class: string | null
          market_value: string | null
          market_weight: string | null
          valuation_date: string
        }>(
          `WITH latest AS (
             SELECT id, valuation_date
             FROM ops_email_valuation_records
             WHERE ($1 <> '' AND BTRIM(product_code) ILIKE $1) OR fund_name ILIKE $2
             ORDER BY valuation_date DESC, id DESC
             LIMIT 1
           )
           SELECT h.subject_name, h.asset_class, h.market_value::text, h.market_weight::text, l.valuation_date::text
           FROM latest l
           JOIN ops_email_valuation_holdings h ON h.valuation_record_id = l.id
           WHERE ABS(COALESCE(h.market_value,0)) > 10000
             AND COALESCE(h.asset_class, '') NOT IN ('margin_deposit','settlement_reserve','cash')
             AND h.subject_name NOT ILIKE '%保证金%'
             AND h.subject_name NOT ILIKE '%备付金%'
             AND h.subject_name NOT ILIKE '%银行存款%'
           ORDER BY ABS(COALESCE(h.market_value,0)) DESC
           LIMIT 30`,
          [code, `%${p.product_name}%`],
        ).catch(() => [])
        valHoldings = rows.map((h) => ({
          name: h.subject_name,
          asset_class: h.asset_class,
          market_value: num(h.market_value),
          market_weight: num(h.market_weight),
          valuation_date: h.valuation_date,
        }))
      }

      reportProducts.push({
        id: p.managed_product_id,
        beian_hao: code,
        product_name: p.product_name,
        short_name: (p.short_name || p.product_name).replace(/私募证券投资基金$/, ""),
        unit_nav: num(p.unit_nav),
        nav_date: p.nav_date,
        return_pct: num(p.return_pct),
        ret_1w: num(p.ret_1w),
        ret_1m: num(p.ret_1m),
        ret_3m: num(p.ret_3m),
        ret_6m: num(p.ret_6m),
        ret_1y: num(p.ret_1y),
        sharpe_1y: num(p.sharpe_1y),
        calmar_1y: num(p.calmar_1y),
        custody_balance: num(p.custody_balance),
        net_asset_value: num(p.net_asset_value),
        company_strategy_l1: t6?.company_strategy_one || p.company_strategy_l1,
        company_strategy_l2: t6?.company_strategy_two || p.company_strategy_l2,
        company_strategy_l3: t6?.company_strategy_three || p.company_strategy_l3,
        platform_strategy_l1: t6?.platform_strategy_one || p.platform_strategy_l1,
        platform_strategy_l2: t6?.platform_strategy_two || p.platform_strategy_l2,
        manager: info?.manager || null,
        advisor: el?.advisor || null,
        custodian: el?.mandator_name || null,
        inception_date: el?.inception_date || info?.inception_date || null,
        risk_level: el?.risk_level || null,
        fee_manage: el?.fee_manage || null,
        fee_trust: el?.fee_trust || null,
        fee_pay: el?.fee_pay || null,
        open_day: el?.open_day || null,
        closed_period: el?.closed_period || null,
        risk: metricsFromNav(navPoints, AS_OF),
        nav_chart: downsample(navPoints),
        fof_holdings: holdings,
        valuation_holdings: valHoldings,
      })
    }

    const needles = [
      "荣熙", "衡颐", "金舆", "抱朴", "低波", "CTA", "主观期货", "强势股", "FOF",
      "六妙星", "棕榈滩", "瀛岳", "宁苑", "青钱", "交睿", "如川", "恒盈",
      "趋势跟踪", "截面", "商品套利", "市场中性", "指增",
    ]
    for (const p of reportProducts) {
      needles.push(p.short_name)
      if (p.manager) needles.push(p.manager.replace(/有限公司|私募|证券|基金|管理|资产/, "").slice(0, 8))
    }
    const unique = [...new Set(needles.map((s) => s.trim()).filter((s) => s.length >= 2))].slice(0, 60)
    const likes = unique.map((k) => `%${k}%`)
    const ph = likes.map((_, i) => `$${i + 1}`).join(", ")
    const kbRows = await query<{ source: string; snippet: string }>(
      `SELECT source, LEFT(content, 1400) AS snippet
       FROM kb_chunks
       WHERE content ILIKE ANY(ARRAY[${ph}]) OR source ILIKE ANY(ARRAY[${ph}])
       ORDER BY CASE WHEN source ILIKE '%内部尽调%' OR source ILIKE '%路演%' THEN 0 ELSE 1 END, LENGTH(content) DESC
       LIMIT 260`,
      likes,
    ).catch(() => [])

    const kbByProduct: Record<string, Array<{ source: string; windows: string[] }>> = {}
    for (const p of reportProducts) {
      const keys = [p.short_name, p.product_name, p.manager?.replace(/有限公司$/, "") || ""].filter((x) => x.length >= 2)
      const hits: Array<{ source: string; windows: string[] }> = []
      for (const row of kbRows) {
        const windows = extractWindows(row.snippet || "", keys)
        if (!windows.length) continue
        hits.push({ source: row.source, windows: windows.slice(0, 2) })
        if (hits.length >= 5) break
      }
      kbByProduct[p.beian_hao] = hits
    }

    const underlyingNames = [...new Set(reportProducts.flatMap((p) => p.fof_holdings.slice(0, 8).map((h) => h.name.replace(/[ABC类]$/, "").slice(0, 8))))]
    const kbByUnderlying: Record<string, Array<{ source: string; windows: string[] }>> = {}
    for (const name of underlyingNames.slice(0, 40)) {
      if (name.length < 2) continue
      const hits: Array<{ source: string; windows: string[] }> = []
      for (const row of kbRows) {
        const windows = extractWindows(row.snippet || "", [name])
        if (!windows.length) continue
        hits.push({ source: row.source, windows: windows.slice(0, 1) })
        if (hits.length >= 2) break
      }
      if (hits.length) kbByUnderlying[name] = hits
    }

    const strategyKb = kbRows
      .filter((r) => /CTA|低波|趋势跟踪|FOF|强势股|主观期货|商品/.test(`${r.source}${r.snippet}`))
      .slice(0, 16)
      .map((r) => ({
        source: r.source,
        windows: extractWindows(r.snippet, ["CTA", "低波", "FOF", "强势股", "主观期货", "趋势跟踪", "波动"], 180).slice(0, 2),
      }))
      .filter((r) => r.windows.length)

    const payload = {
      generated_at: new Date().toISOString(),
      as_of: AS_OF,
      filters: { run_status: "运行中", note: "当前在管产品全量（与界面共11条一致）" },
      product_count: reportProducts.length,
      total_nav: reportProducts.reduce((s, p) => s + (p.net_asset_value ?? 0), 0),
      products: reportProducts,
      kb_by_product: kbByProduct,
      kb_by_underlying: kbByUnderlying,
      strategy_kb: strategyKb,
    }
    fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2), "utf8")
    console.log(`wrote ${OUT_PATH}`)
    for (const p of reportProducts) {
      console.log(`${p.beian_hao} ${p.short_name} nav=${p.net_asset_value} fof=${p.fof_holdings.length} val=${p.valuation_holdings.length} kb=${(kbByProduct[p.beian_hao] || []).length}`)
    }
  } finally {
    tunnel?.kill()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
