import { query } from "@/lib/db"
import { invalidateDetailResponseMemoryCache } from "@/lib/server/fund-detail-response-memory-cache"

export async function ensureTeamBenchmarksTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS ops_fund_team_benchmarks (
      beian_hao  VARCHAR(64) PRIMARY KEY,
      benchmark  VARCHAR(255) NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

export async function loadTeamBenchmark(keys: string[]): Promise<string | null> {
  if (!keys.length) return null
  await ensureTeamBenchmarksTable()
  const rows = await query<{ benchmark: string }>(
    `SELECT benchmark
     FROM ops_fund_team_benchmarks
     WHERE beian_hao = ANY($1::text[])
     ORDER BY
       CASE WHEN UPPER(BTRIM(beian_hao)) = UPPER(BTRIM($2)) THEN 0 ELSE 1 END,
       updated_at DESC
     LIMIT 1`,
    [keys, keys[0]],
  )
  return rows[0]?.benchmark?.trim() || null
}

export async function upsertTeamBenchmark(beianHao: string, benchmark: string | null) {
  await ensureTeamBenchmarksTable()
  const value = (benchmark ?? "").trim()
  if (!value) {
    await query(`DELETE FROM ops_fund_team_benchmarks WHERE beian_hao = $1`, [beianHao])
    invalidateDetailResponseMemoryCache([beianHao])
    return
  }
  await query(
    `INSERT INTO ops_fund_team_benchmarks (beian_hao, benchmark, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (beian_hao) DO UPDATE
     SET benchmark = EXCLUDED.benchmark, updated_at = NOW()`,
    [beianHao, value],
  )
  invalidateDetailResponseMemoryCache([beianHao])
}

export async function upsertTeamBenchmarks(ids: string[], benchmark: string) {
  for (const id of ids) {
    await upsertTeamBenchmark(id, benchmark)
  }
}
