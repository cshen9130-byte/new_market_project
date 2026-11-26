/**
 * 小荷公众号 rows for one 周度回顾(股票) week.
 * A matched product uses our NAV on the sheet's 口径. Otherwise the row keeps
 * the published number for that same 口径: absolute windows, or week excess.
 */

import { readFile } from "fs/promises"
import * as XLSX from "xlsx"
import { query } from "@/lib/db"
import { getKnowledgeBaseFile } from "@/lib/server/knowledge-base"
import {
  chooseXiaoheMetrics,
  mergeXiaoheComparable,
  emptyXiaohePeriods,
  indexXiaoheCatalog,
  matchXiaoheCatalog,
  mergeXiaoheOcrRows,
  parseXiaoheOcrGrid,
  xiaoheNameKey,
  xiaoheOcrComparable,
  xiaoheStrategyBucket,
  type XiaoheCatalogHit,
  type XiaoheComparable,
  type XiaoheOcrRow,
} from "@/lib/ma/xiaohe-weekly-rows"
import { WEEKLY_REVIEW_STATUS_HIDDEN_BUCKETS } from "@/lib/weekly-review-data-status"
import { loadExternalRankWeekFiles } from "@/lib/server/external-rank-week"
import {
  computeFundMetrics,
  metricModeForBucket,
  type FundMetrics,
  type WeeklyReviewFund,
} from "@/lib/server/jy-weekly-review"

export type XiaoheWeeklyRow = {
  bucket: string
  metrics: FundMetrics
  fromDatabase: boolean
  nameKey: string
}

type Candidate = {
  bucket: string
  product: string
  manager: string
  published: XiaoheComparable
  nameKey: string
  beian: string | null
}

function asComparable(row: FundMetrics): XiaoheComparable {
  return {
    ret: row.ret,
    excess: row.excess,
    excess_dd_6m: row.excess_dd_6m,
    excess_dd_1y: row.excess_dd_1y,
    sharpe_1y: row.sharpe_1y,
    calmar_1y: row.calmar_1y,
  }
}

function metricsFromPublished(
  name: string,
  beian: string,
  bucket: string,
  mode: "absolute" | "excess",
  published: XiaoheComparable,
): FundMetrics {
  const blank = emptyXiaohePeriods()
  return {
    beian_hao: beian,
    name,
    bucket,
    mode,
    ret: mode === "absolute" ? { ...published.ret } : { ...blank },
    excess: mode === "excess" ? { ...published.excess } : { ...blank },
    excess_dd_6m: null,
    excess_dd_1y: null,
    sharpe_1y: null,
    calmar_1y: null,
  }
}

async function readXiaoheOcrRows(weekEnd: string): Promise<XiaoheOcrRow[]> {
  const files = await loadExternalRankWeekFiles(weekEnd, "files")
  const absolute: XiaoheOcrRow[] = []
  const excess: XiaoheOcrRow[] = []
  for (const file of files) {
    try {
      const stored = await getKnowledgeBaseFile(file.path)
      const data = await readFile(stored.absolutePath)
      const workbook = XLSX.read(data, { type: "buffer", cellDates: true })
      for (const name of workbook.SheetNames) {
        const sheet = workbook.Sheets[name]
        if (!sheet) continue
        const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
          header: 1,
          raw: true,
          defval: null,
          blankrows: false,
        })
        const parsed = parseXiaoheOcrGrid(grid)
        if (parsed.kind === "excess") excess.push(...parsed.rows)
        else if (parsed.kind === "absolute") absolute.push(...parsed.rows)
      }
    } catch (err) {
      console.error("[xiaohe-weekly] file skipped:", file.name, err)
    }
  }
  return mergeXiaoheOcrRows([...absolute, ...excess])
}

async function loadCatalog(): Promise<XiaoheCatalogHit[]> {
  const [products, shorts] = await Promise.all([
    query<{ beian_hao: string; product_name: string; manager: string | null }>(
      `SELECT beian_hao, product_name, manager
       FROM private_fund_info
       WHERE COALESCE(BTRIM(product_name), '') <> ''`,
    ),
    query<{ beian_hao: string; short_name: string; manager: string | null }>(
      `SELECT b.beian_hao, b.short_name, i.manager
       FROM private_fund_info_bfl b
       LEFT JOIN private_fund_info i ON i.beian_hao = b.beian_hao
       WHERE COALESCE(BTRIM(b.short_name), '') <> ''`,
    ).catch(() => [] as Array<{ beian_hao: string; short_name: string; manager: string | null }>),
  ])
  const hits: XiaoheCatalogHit[] = []
  for (const row of products) {
    const key = xiaoheNameKey(row.product_name)
    if (!key) continue
    hits.push({
      beian: row.beian_hao,
      name: row.product_name,
      manager: row.manager ?? "",
      key,
    })
  }
  for (const row of shorts) {
    const key = xiaoheNameKey(row.short_name)
    if (!key) continue
    hits.push({
      beian: row.beian_hao,
      name: row.short_name,
      manager: row.manager ?? "",
      key,
    })
  }
  return hits
}

export async function loadXiaoheWeeklyRows(weekEnd: string): Promise<XiaoheWeeklyRow[]> {
  const pending: Candidate[] = []
  for (const row of await readXiaoheOcrRows(weekEnd)) {
    const bucket = xiaoheStrategyBucket(row.strategy)
    if (!bucket || WEEKLY_REVIEW_STATUS_HIDDEN_BUCKETS.has(bucket)) continue
    const nameKey = xiaoheNameKey(row.product)
    if (!nameKey) continue
    pending.push({
      bucket,
      product: row.product,
      manager: row.manager,
      published: xiaoheOcrComparable(row),
      nameKey,
      beian: null,
    })
  }
  if (pending.length === 0) return []

  let indexed: ReturnType<typeof indexXiaoheCatalog> | null = null
  try {
    indexed = indexXiaoheCatalog(await loadCatalog())
  } catch (err) {
    console.error("[xiaohe-weekly] name catalog skipped:", err)
  }
  if (indexed) {
    for (const row of pending) {
      row.beian = matchXiaoheCatalog(row.product, row.manager, indexed.byKey, indexed.suffixIndex)?.beian ?? null
    }
  }

  const funds: WeeklyReviewFund[] = []
  for (const row of pending) {
    if (!row.beian) continue
    funds.push({
      beian_hao: row.beian,
      product_name: row.product,
      short_name: null,
      l1: "股票策略",
      l2: row.bucket,
      l3: null,
    })
  }
  const computed = funds.length === 0
    ? []
    : await computeFundMetrics(funds, weekEnd, undefined, {
      bucketFor: (fund) => fund.l2 || "",
    })
  const byBeianBucket = new Map<string, FundMetrics>()
  for (const row of computed) byBeianBucket.set(`${row.beian_hao}\0${row.bucket}`, row)

  const out: XiaoheWeeklyRow[] = []
  const emitted = new Set<string>()
  for (const row of pending) {
    const mode = metricModeForBucket(row.bucket)
    const database = row.beian ? byBeianBucket.get(`${row.beian}\0${row.bucket}`) ?? null : null
    const dbComparable = database ? asComparable(database) : null
    const merged = mergeXiaoheComparable(mode, dbComparable, row.published)
    if (!merged) continue
    const dedupe = dbComparable && row.beian ? `${row.bucket}\0${row.beian}` : `${row.bucket}\0${row.nameKey}`
    if (emitted.has(dedupe)) continue
    emitted.add(dedupe)
    out.push({
      bucket: row.bucket,
      metrics: metricsFromPublished(row.product, row.beian ?? "", row.bucket, mode, merged),
      fromDatabase: dbComparable != null && chooseXiaoheMetrics(mode, dbComparable, null) === "database",
      nameKey: row.nameKey,
    })
  }
  return out
}

/** 备案号 of products on this week's 小荷公众号 board that match the fund catalog. */
export async function listXiaoheWeeklyBeians(weekEnd: string): Promise<string[]> {
  const pending = await readXiaoheOcrRows(weekEnd)
  if (pending.length === 0) return []
  let indexed: ReturnType<typeof indexXiaoheCatalog> | null = null
  try {
    indexed = indexXiaoheCatalog(await loadCatalog())
  } catch (err) {
    console.error("[xiaohe-weekly] name catalog skipped:", err)
    return []
  }
  const codes = new Set<string>()
  for (const row of pending) {
    const bucket = xiaoheStrategyBucket(row.strategy)
    if (!bucket || WEEKLY_REVIEW_STATUS_HIDDEN_BUCKETS.has(bucket)) continue
    const beian = matchXiaoheCatalog(row.product, row.manager, indexed.byKey, indexed.suffixIndex)?.beian
    const code = (beian ?? "").trim()
    if (code) codes.add(code)
  }
  return [...codes]
}
