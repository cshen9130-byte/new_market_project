/**
 * Persistent weekly-review Excel files, keyed by variant + pools + week end.
 * The page download button reads from here; scheduled jobs keep the last three
 * report weeks (equity/futures only when NAV coverage is strictly above 80%).
 */

import { mkdir, readFile, writeFile } from "fs/promises"
import path from "path"
import {
  DEFAULT_WEEKLY_REVIEW_POOLS,
  normalizeWeeklyReviewPools,
  type WeeklyReviewPoolKey,
} from "@/lib/ma/weekly-review-pools"
import { addDays } from "@/lib/server/list-cache-nav-batch"
import { defaultWeeklyReviewWeekEnd, mondayOfWeek } from "@/lib/server/jy-weekly-review"
import { getWeeklyReviewDataStatus } from "@/lib/server/weekly-review-data-status"
import {
  latestReadyWeeklyStrategyWeek,
  weeklyStrategyExcelWeeks,
  type WeeklyCoverage,
} from "@/lib/system-notifications"

export type WeeklyReviewExcelVariant = "equity" | "futures" | "public-enhanced"

export type WeeklyReviewExcelMeta = {
  variant: WeeklyReviewExcelVariant
  weekEnd: string
  pools: WeeklyReviewPoolKey[]
  fileName: string
  fundCount?: number
  groupCount?: number
  generatedAt: string
}

export type WeeklyReviewReadyWeek = WeeklyCoverage & {
  fileReady: boolean
}

type WorkbookResult = {
  buffer: Buffer
  fileName: string
  fundCount: number
  groupCount: number
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const CACHE_ROOT = path.join(process.cwd(), "data", "exports", "weekly-review-excel")

function poolsKey(pools: WeeklyReviewPoolKey[]): string {
  return normalizeWeeklyReviewPools(pools).join("-") || "jy"
}

export function weeklyReviewExcelCacheDir(
  variant: WeeklyReviewExcelVariant,
  weekEnd: string,
  poolsInput?: unknown,
): string {
  const week = weekEnd.slice(0, 10)
  if (!ISO_DATE.test(week)) throw new Error("无效的报告周截止日")
  const suffix = variant === "public-enhanced" ? "all" : poolsKey(normalizeWeeklyReviewPools(poolsInput))
  return path.join(CACHE_ROOT, variant, suffix, week)
}

function filePath(dir: string): string {
  return path.join(dir, "report.xlsx")
}

function metaPath(dir: string): string {
  return path.join(dir, "meta.json")
}

export async function saveWeeklyReviewExcelCache(
  variant: WeeklyReviewExcelVariant,
  weekEndRaw: string,
  poolsInput: unknown,
  result: WorkbookResult,
): Promise<WeeklyReviewExcelMeta> {
  const weekEnd = weekEndRaw.slice(0, 10)
  const pools = variant === "public-enhanced" ? [] : normalizeWeeklyReviewPools(poolsInput)
  const dir = weeklyReviewExcelCacheDir(variant, weekEnd, pools)
  await mkdir(dir, { recursive: true })
  await writeFile(filePath(dir), result.buffer)
  const meta: WeeklyReviewExcelMeta = {
    variant,
    weekEnd,
    pools,
    fileName: result.fileName,
    fundCount: result.fundCount,
    groupCount: result.groupCount,
    generatedAt: new Date().toISOString(),
  }
  await writeFile(metaPath(dir), JSON.stringify(meta), "utf8")
  return meta
}

export async function readWeeklyReviewExcelCache(
  variant: WeeklyReviewExcelVariant,
  weekEnd: string,
  poolsInput?: unknown,
): Promise<{ buffer: Buffer; fileName: string; meta: WeeklyReviewExcelMeta }> {
  const dir = weeklyReviewExcelCacheDir(variant, weekEnd, poolsInput)
  const raw = await readFile(metaPath(dir), "utf8").catch(() => null)
  if (!raw) throw new Error("本周 Excel 尚未生成，请点击重新生成")
  const meta = JSON.parse(raw) as WeeklyReviewExcelMeta
  if (!meta.fileName) throw new Error("本周 Excel 尚未生成，请点击重新生成")
  const buffer = await readFile(filePath(dir))
  return { buffer, fileName: meta.fileName, meta }
}

export async function weeklyReviewExcelCacheExists(
  variant: WeeklyReviewExcelVariant,
  weekEnd: string,
  poolsInput?: unknown,
): Promise<boolean> {
  try {
    await readFile(metaPath(weeklyReviewExcelCacheDir(variant, weekEnd, poolsInput)), "utf8")
    return true
  } catch {
    return false
  }
}

export async function getLatestReadyWeeklyReviewWeek(
  variant: WeeklyReviewExcelVariant,
  poolsInput?: unknown,
): Promise<WeeklyCoverage | null> {
  if (variant === "public-enhanced") {
    const weekEnd = defaultWeeklyReviewWeekEnd()
    return { weekStart: "", weekEnd, total: 0, covered: 0, ready: true }
  }
  const pools = normalizeWeeklyReviewPools(poolsInput ?? DEFAULT_WEEKLY_REVIEW_POOLS)
  const status = await getWeeklyReviewDataStatus(variant, false, {
    pools,
    weekEnd: defaultWeeklyReviewWeekEnd(),
  })
  return latestReadyWeeklyStrategyWeek(status)
}

/** Last three report weeks, newest first. Public-enhanced has no 80% gate. */
export async function listWeeklyReviewScheduleWeeks(
  variant: WeeklyReviewExcelVariant,
  poolsInput?: unknown,
): Promise<WeeklyCoverage[]> {
  if (variant === "public-enhanced") {
    const anchor = defaultWeeklyReviewWeekEnd()
    return [anchor, addDays(anchor, 7), addDays(anchor, 14)].map((weekEnd) => ({
      weekStart: mondayOfWeek(weekEnd),
      weekEnd,
      total: 0,
      covered: 0,
      ready: true,
    }))
  }
  const pools = normalizeWeeklyReviewPools(poolsInput ?? DEFAULT_WEEKLY_REVIEW_POOLS)
  const status = await getWeeklyReviewDataStatus(variant, false, {
    pools,
    weekEnd: defaultWeeklyReviewWeekEnd(),
  })
  return weeklyStrategyExcelWeeks(status)
}

export async function resolveWeeklyReviewReadyWeek(
  variant: WeeklyReviewExcelVariant,
  poolsInput?: unknown,
): Promise<WeeklyReviewReadyWeek> {
  const pools = variant === "public-enhanced" ? undefined : normalizeWeeklyReviewPools(poolsInput)
  const coverage = await getLatestReadyWeeklyReviewWeek(variant, pools)
  const weekEnd = coverage?.weekEnd || defaultWeeklyReviewWeekEnd()
  const ready = coverage?.ready ?? false
  return {
    weekStart: coverage?.weekStart ?? "",
    weekEnd,
    total: coverage?.total ?? 0,
    covered: coverage?.covered ?? 0,
    ready,
    fileReady: weekEnd ? await weeklyReviewExcelCacheExists(variant, weekEnd, pools) : false,
  }
}

export async function generateAndCacheWeeklyReviewExcel(
  variant: WeeklyReviewExcelVariant,
  weekEndRaw: string,
  poolsInput?: unknown,
): Promise<WeeklyReviewExcelMeta> {
  const weekEnd = weekEndRaw.slice(0, 10)
  if (!ISO_DATE.test(weekEnd)) throw new Error("无效的报告周截止日")
  let result: WorkbookResult
  if (variant === "equity") {
    const { generateJyWeeklyReviewWorkbook } = await import("@/lib/server/jy-weekly-review")
    result = await generateJyWeeklyReviewWorkbook(weekEnd, poolsInput)
  } else if (variant === "futures") {
    const { generateJyFuturesWeeklyReviewWorkbook } = await import("@/lib/server/jy-weekly-review-futures")
    result = await generateJyFuturesWeeklyReviewWorkbook(weekEnd, poolsInput)
  } else {
    const { generatePublicEnhancedWeeklyWorkbook } = await import("@/lib/server/public-enhanced-weekly-review")
    result = await generatePublicEnhancedWeeklyWorkbook(weekEnd)
  }
  return saveWeeklyReviewExcelCache(variant, weekEnd, poolsInput, result)
}

export type ScheduledWeeklyReviewExcelResult = {
  reason: string
  items: Array<{
    variant: WeeklyReviewExcelVariant
    weekEnd: string
    ok: boolean
    skipped?: string
    fileName?: string
    error?: string
  }>
}

function shouldRefreshCachedWeeks(reason: string, options?: { refreshCached?: boolean }): boolean {
  if (options?.refreshCached != null) return options.refreshCached
  return /^(daily-cron|backfill)/.test(reason)
}

export async function runScheduledWeeklyReviewExcel(
  reason: string,
  options?: { refreshCached?: boolean },
): Promise<ScheduledWeeklyReviewExcelResult> {
  const items: ScheduledWeeklyReviewExcelResult["items"] = []
  const refreshCached = shouldRefreshCachedWeeks(reason, options)
  const jobs: Array<{ variant: WeeklyReviewExcelVariant; pools?: WeeklyReviewPoolKey[] }> = [
    { variant: "equity", pools: [...DEFAULT_WEEKLY_REVIEW_POOLS] },
    { variant: "futures", pools: [...DEFAULT_WEEKLY_REVIEW_POOLS] },
    { variant: "public-enhanced" },
  ]
  for (const job of jobs) {
    try {
      const weeks = await listWeeklyReviewScheduleWeeks(job.variant, job.pools)
      const latestReady = weeks.find((week) => week.ready)
      if (weeks.length === 0) {
        items.push({
          variant: job.variant,
          weekEnd: defaultWeeklyReviewWeekEnd(),
          ok: false,
          skipped: "no-weeks",
        })
        continue
      }
      for (const coverage of weeks) {
        const weekEnd = coverage.weekEnd
        if (job.variant !== "public-enhanced" && !coverage.ready) {
          items.push({ variant: job.variant, weekEnd, ok: false, skipped: "coverage-below-80" })
          continue
        }
        const exists = await weeklyReviewExcelCacheExists(job.variant, weekEnd, job.pools)
        const isLatestReady = latestReady?.weekEnd === weekEnd
        if (exists && !isLatestReady && !refreshCached) {
          items.push({ variant: job.variant, weekEnd, ok: true, skipped: "already-cached" })
          continue
        }
        const meta = await generateAndCacheWeeklyReviewExcel(job.variant, weekEnd, job.pools)
        items.push({
          variant: job.variant,
          weekEnd,
          ok: true,
          fileName: meta.fileName,
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[weekly-review-excel] ${job.variant} failed:`, message)
      items.push({
        variant: job.variant,
        weekEnd: defaultWeeklyReviewWeekEnd(),
        ok: false,
        error: message,
      })
    }
  }
  return { reason, items }
}

export async function backfillWeeklyReviewExcelLastWeeks(
  reason = "backfill-last-three",
): Promise<ScheduledWeeklyReviewExcelResult> {
  return runScheduledWeeklyReviewExcel(reason, { refreshCached: true })
}
