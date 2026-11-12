import { existsSync, readFileSync, writeFileSync } from "fs"
import path from "path"
import { fmtIso, n, publicQuery, query } from "@/lib/db"

export const CI011001_REBUILD_KEY = "CI011001.REBUILD"
export const CI011001_REBUILD_LABEL = "全天候指数"

export type Ci011001Point = { date: string; value: number }

export function resolveAllWeatherDir(): string | null {
  const env = (process.env.ALL_WEATHER_DIR ?? "").trim()
  const candidates = [
    env,
    "D:\\coding\\all_weather",
    path.join(process.cwd(), "..", "all_weather"),
    "/root/all_weather",
    "/root/coding/all_weather",
  ].filter(Boolean)
  for (const dir of candidates) {
    if (existsSync(path.join(dir, "run_ci011001.py"))) return dir
  }
  return null
}

export function resolveRebuildCsvPath(): string | null {
  const override = (process.env.CI011001_REBUILD_CSV ?? "").trim()
  if (override && existsSync(override)) return override
  const root = resolveAllWeatherDir()
  if (!root) return null
  const csv = path.join(root, "output_ci011001", "rebuild_index_levels.csv")
  return existsSync(csv) ? csv : null
}

export function parseRebuildIndexLevelsCsv(text: string): Ci011001Point[] {
  const points: Ci011001Point[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const parts = line.split(",")
    if (parts.length < 2) continue
    const date = parts[0]?.trim() ?? ""
    const value = Number(parts[1])
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(value) || value <= 0) continue
    points.push({ date, value })
  }
  return points
}

export function readRebuildIndexLevelsCsv(csvPath?: string | null): Ci011001Point[] {
  const resolved = csvPath || resolveRebuildCsvPath()
  if (!resolved) return []
  return parseRebuildIndexLevelsCsv(readFileSync(resolved, "utf8"))
}

export function readRebuildModelName(allWeatherDir?: string | null): string | null {
  const root = allWeatherDir || resolveAllWeatherDir()
  if (!root) return null
  const summaryPath = path.join(root, "output_ci011001", "summary.json")
  if (!existsSync(summaryPath)) return null
  try {
    const payload = JSON.parse(readFileSync(summaryPath, "utf8")) as { chosen_model?: unknown }
    return typeof payload.chosen_model === "string" && payload.chosen_model.trim()
      ? payload.chosen_model.trim()
      : null
  } catch {
    return null
  }
}

export async function ensureCi011001RebuildTable(): Promise<void> {
  await publicQuery(`
    CREATE TABLE IF NOT EXISTS public.raw_ci011001_rebuild_daily (
      trade_date  DATE             NOT NULL PRIMARY KEY,
      close       DOUBLE PRECISION NOT NULL,
      model       TEXT,
      source      VARCHAR(40)      NOT NULL DEFAULT 'all_weather_rebuild',
      fetched_at  TIMESTAMPTZ      NOT NULL DEFAULT NOW()
    )
  `)
}

export async function upsertCi011001RebuildPoints(
  points: Ci011001Point[],
  model?: string | null,
): Promise<number> {
  if (!points.length) return 0
  await ensureCi011001RebuildTable()
  const chunkSize = 400
  let written = 0
  for (let i = 0; i < points.length; i += chunkSize) {
    const chunk = points.slice(i, i + chunkSize)
    const values: unknown[] = []
    const placeholders = chunk.map((point, idx) => {
      const base = idx * 4
      values.push(point.date, point.value, model ?? null, "all_weather_rebuild")
      return `($${base + 1}::date, $${base + 2}, $${base + 3}, $${base + 4})`
    })
    await publicQuery(
      `INSERT INTO public.raw_ci011001_rebuild_daily (trade_date, close, model, source)
       VALUES ${placeholders.join(",")}
       ON CONFLICT (trade_date) DO UPDATE
         SET close = EXCLUDED.close,
             model = COALESCE(EXCLUDED.model, public.raw_ci011001_rebuild_daily.model),
             source = EXCLUDED.source,
             fetched_at = NOW()`,
      values,
    )
    written += chunk.length
  }
  return written
}

function ymd(value: Date | string): string {
  return fmtIso(value).slice(0, 10)
}

/** Refresh the 沪深300 cache the rebuild splices onto, from server Postgres. */
export async function refreshHs300RebuildCache(allWeatherDir: string): Promise<{
  rows: number
  latest: string | null
  path: string
}> {
  const rows = await query<{ trade_date: Date | string; close: string | number | null }>(
    `SELECT trade_date, close
     FROM raw_ashare_index_daily
     WHERE ts_code = '000300.SH'
       AND close IS NOT NULL
       AND close > 0
     ORDER BY trade_date ASC`,
  )
  const lines = ["date,close"]
  let latest: string | null = null
  for (const row of rows) {
    const value = n(row.close)
    if (value == null || value <= 0) continue
    const date = ymd(row.trade_date)
    lines.push(`${date},${value}`)
    latest = date
  }
  const outPath = path.join(allWeatherDir, "data", "ci011001", "raw_000300.csv")
  writeFileSync(outPath, `${lines.join("\n")}\n`, "utf8")
  return { rows: lines.length - 1, latest, path: outPath }
}

export async function loadCi011001RebuildPrices(
  from: string,
  to: string,
): Promise<Ci011001Point[]> {
  try {
    const rows = await query<{ trade_date: Date | string; close: string | number | null }>(
      `SELECT trade_date, close
       FROM public.raw_ci011001_rebuild_daily
       WHERE trade_date >= $1::date
         AND trade_date <= $2::date
         AND close IS NOT NULL
         AND close > 0
       ORDER BY trade_date ASC`,
      [from, to],
    )
    const data = rows
      .map((row) => ({ date: fmtIso(row.trade_date), value: n(row.close) }))
      .filter((row): row is Ci011001Point => row.value != null && row.value > 0)
    if (data.length) return data
  } catch {
    // Table may not exist yet; fall through to the local rebuild CSV.
  }
  return readRebuildIndexLevelsCsv().filter((row) => row.date >= from && row.date <= to)
}
