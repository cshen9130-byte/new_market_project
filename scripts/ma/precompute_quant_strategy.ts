/**
 * Precompute 量化策略分析 payloads into today's mom-cache files.
 *
 * The page reads these files and does not rerun the SQL / factor inference.
 * Each file is the full page payload, including the later charts:
 * book risk, trade frequency, sector vol, alpha/beta, R:R shape,
 * linear scatters, and the factor panel.
 * A file missing those blocks is rebuilt. Nightly ETL and the MOM
 * data-import job both call this script.
 *
 *   npx tsx scripts/ma/precompute_quant_strategy.ts
 *   npx tsx scripts/ma/precompute_quant_strategy.ts --force
 *   npx tsx scripts/ma/precompute_quant_strategy.ts --account=319 --range=全部
 */

import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "@/lib/server/load-project-env"
import type { QuantStrategyRangeLabel } from "@/lib/ma/quant-strategy-ranges"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

function hasChartPayload(body: unknown): boolean {
  if (!body || typeof body !== "object") return false
  const row = body as Record<string, unknown>
  const portrait = row.portrait
  const bookStyle = portrait && typeof portrait === "object"
    ? (portrait as Record<string, unknown>).bookStyle
    : null
  return row.bookRisk != null
    && row.tradeFrequency != null
    && row.sectorVol != null
    && row.alphaBeta != null
    && row.rrShape != null
    && row.linearScatters != null
    && bookStyle != null
}

function parseArgs(argv: string[]) {
  let force = false
  let account: string | null = null
  let range: string | null = null
  for (const arg of argv) {
    if (arg === "--force") force = true
    else if (arg.startsWith("--account=")) account = arg.slice("--account=".length).replace(/\D/g, "") || null
    else if (arg.startsWith("--range=")) range = arg.slice("--range=".length).trim() || null
  }
  return { force, account, range }
}

async function main() {
  const { force, account, range } = parseArgs(process.argv.slice(2))
  const { paramKey, readCache } = await import("@/lib/server/mom-cache")
  const { QUANT_STRATEGY_CACHE_KEY, GET } = await import("@/app/ma/api/mom-analysis/quant-strategy/route")
  const { quantStrategyBounds, quantStrategyWarmQueries } = await import("@/lib/ma/quant-strategy-ranges")

  console.error(`[precompute_quant_strategy] cache key ${QUANT_STRATEGY_CACHE_KEY}`)
  let queries = quantStrategyWarmQueries()
  if (account) queries = queries.filter((q) => q.account === account)
  if (range) {
    const bounds = quantStrategyBounds(range as QuantStrategyRangeLabel)
    queries = queries.filter((q) => q.from === bounds.from && q.to === bounds.to)
  }
  if (!queries.length) {
    throw new Error(`no queries matched account=${account ?? "*"} range=${range ?? "*"}`)
  }

  let ok = 0
  let cached = 0
  let failed = 0
  const errors: string[] = []
  const t0 = Date.now()

  for (const q of queries) {
    const sp = new URLSearchParams({ account: q.account, from: q.from, to: q.to })
    if (q.scope === "core") sp.set("scope", "core")
    const key = `mom__${QUANT_STRATEGY_CACHE_KEY}${paramKey(sp)}`
    const label = `rx${q.account} ${q.from}..${q.to} ${q.scope}`
    const cachedBody = force ? null : readCache(key)
    if (cachedBody != null && hasChartPayload(cachedBody)) {
      cached++
      console.error(`[precompute_quant_strategy] cache ${label}`)
      continue
    }
    const url = new URL(`http://127.0.0.1/ma/api/mom-analysis/quant-strategy?${sp}`)
    if (force) url.searchParams.set("nocache", "1")
    const started = Date.now()
    try {
      const res = await GET(new Request(url))
      const body = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok || body?.ok === false) {
        failed++
        const msg = `${label}: ${body?.error || res.status}`
        errors.push(msg)
        console.error(`[precompute_quant_strategy] fail ${msg}`)
        continue
      }
      ok++
      console.error(`[precompute_quant_strategy] ok ${label} ${Date.now() - started}ms`)
    } catch (err) {
      failed++
      const msg = `${label}: ${err instanceof Error ? err.message : String(err)}`
      errors.push(msg)
      console.error(`[precompute_quant_strategy] fail ${msg}`)
    }
  }

  console.log(JSON.stringify({
    ok,
    cached,
    failed,
    total: queries.length,
    ms: Date.now() - t0,
    errors: errors.slice(0, 20),
  }))
  process.exit(ok + cached === 0 ? 1 : 0)
}

main().catch((e) => {
  console.error("[precompute_quant_strategy] Fatal:", e)
  console.log(JSON.stringify({ ok: 0, cached: 0, failed: 1, total: 0, ms: 0, error: String(e) }))
  process.exit(1)
})
