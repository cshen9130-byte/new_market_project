/**
 * Write 量化策略分析 → 当日持仓 into today's mom-cache file.
 *
 * The page reads that file and does not scan positions on open.
 * Nightly ETL and the MOM settlement import both call this script.
 *
 *   npx tsx scripts/ma/precompute_quant_positions.ts
 */

import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "@/lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

async function main() {
  const { GET } = await import("@/app/ma/api/mom-analysis/quant-positions/route")
  const started = Date.now()
  const url = new URL("http://127.0.0.1/ma/api/mom-analysis/quant-positions?nocache=1")
  try {
    const res = await GET(new Request(url))
    const body = await res.json() as { ok?: boolean; error?: string; date?: string | null; rows?: unknown[] }
    const ms = Date.now() - started
    if (!res.ok || body?.ok === false) {
      const error = body?.error || `status ${res.status}`
      console.error(`[precompute_quant_positions] fail ${error}`)
      console.log(JSON.stringify({ ok: 0, failed: 1, accounts: 0, date: null, ms, error }))
      process.exit(1)
    }
    const accounts = Array.isArray(body.rows) ? body.rows.length : 0
    console.error(`[precompute_quant_positions] ok date=${body.date ?? "—"} accounts=${accounts} ${ms}ms`)
    console.log(JSON.stringify({ ok: 1, failed: 0, accounts, date: body.date ?? null, ms }))
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error(`[precompute_quant_positions] fail ${error}`)
    console.log(JSON.stringify({ ok: 0, failed: 1, accounts: 0, date: null, ms: Date.now() - started, error }))
    process.exit(1)
  }
}

main().catch((err) => {
  console.error("[precompute_quant_positions] Fatal:", err)
  console.log(JSON.stringify({ ok: 0, failed: 1, accounts: 0, date: null, ms: 0, error: String(err) }))
  process.exit(1)
})
