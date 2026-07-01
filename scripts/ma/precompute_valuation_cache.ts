/**
 * Nightly pre-computation of 估值表分析 page data.
 *
 * For every fund that has at least one parsed 估值表 record, pre-computes:
 *   1. snapshot  — getFundValuationAllocation (all holdings, no curves)
 *   2. trend     — getFundValuationTrendAnalysis for a 1-year window
 *   3. curves    — return_curves array for the same 1-year window (FOF only)
 *
 * Results are stored in ops_valuation_precomputed_cache and served by the
 * valuation API route on the next request (cache TTL = 25 hours).
 *
 * Usage (via nightly_etl.py):
 *   npx tsx scripts/ma/precompute_valuation_cache.ts
 *
 * Run directly:
 *   npx tsx scripts/ma/precompute_valuation_cache.ts [--limit=N] [--beian=XXX]
 */

import { loadProjectEnvFiles } from "@/lib/server/load-project-env"

loadProjectEnvFiles()

import { query } from "@/lib/db"
import {
  ensureValuationCacheTable,
  writeValuationCache,
} from "@/lib/server/valuation-precomputed-cache"
import {
  getFundValuationAllocation,
  getFundValuationTrendAnalysis,
} from "@/lib/server/fund-valuation-allocation"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function subtractOneYear(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`)
  d.setFullYear(d.getFullYear() - 1)
  return d.toISOString().slice(0, 10)
}

function parseArgs(argv: string[]): { limit: number | null; beian: string | null } {
  let limit: number | null = null
  let beian: string | null = null
  for (const arg of argv) {
    if (arg.startsWith("--limit=")) {
      const n = parseInt(arg.slice("--limit=".length), 10)
      if (Number.isFinite(n) && n > 0) limit = n
    }
    if (arg.startsWith("--beian=")) {
      beian = arg.slice("--beian=".length).trim() || null
    }
  }
  return { limit, beian }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { limit, beian: targetBeian } = parseArgs(process.argv.slice(2))
  await ensureValuationCacheTable()

  // Collect all funds with at least one 估值表 record.
  // We join managed_products to get the canonical beian_hao used in the URL.
  const fundRows = await query<{
    beian_hao: string
    valuation_date: string
  }>(
    `SELECT DISTINCT
        COALESCE(mp.beian_hao, m.product_code) AS beian_hao,
        m.valuation_date::text AS valuation_date
     FROM ops_email_valuation_fund_metrics_latest m
     LEFT JOIN managed_products mp
       ON (m.product_code IS NOT NULL AND mp.beian_hao = m.product_code)
       OR (mp.product_name = m.fund_name)
     WHERE COALESCE(mp.beian_hao, m.product_code) IS NOT NULL
     ORDER BY beian_hao`,
  ).catch(async () => {
    // Fallback: managed_products may not exist; use metrics table directly
    return query<{ beian_hao: string; valuation_date: string }>(
      `SELECT DISTINCT
          product_code AS beian_hao,
          valuation_date::text AS valuation_date
       FROM ops_email_valuation_fund_metrics_latest
       WHERE product_code IS NOT NULL
       ORDER BY product_code`,
    )
  })

  let funds = fundRows.filter((r) => r.beian_hao)
  if (targetBeian) {
    funds = funds.filter((r) => r.beian_hao === targetBeian)
  }
  if (limit !== null) {
    funds = funds.slice(0, limit)
  }

  console.error(
    `[precompute_valuation_cache] Starting — ${funds.length} fund(s) to process`,
  )

  let ok = 0
  let failed = 0
  let skipped = 0
  const errors: string[] = []

  for (const fund of funds) {
    const { beian_hao, valuation_date } = fund
    const toDate = valuation_date?.slice(0, 10)
    if (!toDate) {
      skipped++
      continue
    }
    const fromDate = subtractOneYear(toDate)

    // ── 1. Snapshot ──────────────────────────────────────────────────────────
    try {
      const snapshot = await getFundValuationAllocation(beian_hao, "major")
      await writeValuationCache(beian_hao, "snapshot", snapshot)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[precompute_valuation_cache] snapshot ${beian_hao}: ${msg}`)
      errors.push(`snapshot:${beian_hao}: ${msg}`)
      failed++
      continue
    }

    // ── 2. Trend analysis (1-year window) ────────────────────────────────────
    try {
      const trend = await getFundValuationTrendAnalysis(beian_hao, fromDate, toDate)
      await writeValuationCache(beian_hao, "trend", trend, { fromDate, toDate })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[precompute_valuation_cache] trend ${beian_hao}: ${msg}`)
      errors.push(`trend:${beian_hao}: ${msg}`)
      // Non-fatal — snapshot was written; continue to curves
    }

    // ── 3. Return curves (1-year window, FOF only) ───────────────────────────
    try {
      const withCurves = await getFundValuationAllocation(beian_hao, "major", {
        includeReturnCurves: true,
        curvesFrom: fromDate,
        curvesTo: toDate,
      })
      if (withCurves.layout_type === "fof" && withCurves.return_curves.length > 0) {
        await writeValuationCache(beian_hao, "curves", withCurves.return_curves, {
          fromDate,
          toDate,
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[precompute_valuation_cache] curves ${beian_hao}: ${msg}`)
      errors.push(`curves:${beian_hao}: ${msg}`)
      // Non-fatal
    }

    ok++
    console.error(`[precompute_valuation_cache] ✓ ${beian_hao} (${toDate})`)
  }

  const result = {
    ok,
    failed,
    skipped,
    total: funds.length,
    errorCount: errors.length,
    errors: errors.slice(0, 20),
  }

  // Print JSON for nightly_etl.py to consume
  console.log(JSON.stringify(result))
}

main().catch((e) => {
  console.error("[precompute_valuation_cache] Fatal:", e)
  console.log(JSON.stringify({ ok: 0, failed: 1, error: String(e) }))
  process.exit(1)
})
