/**
 * 小荷公众号 and ima点睛 rows for 周度回顾(期货).
 * Those boards name 量化CTA / 主观CTA, not 时序 or 黑色. A row is placed only
 * after the product is found among 量化期货 / 主观期货 funds, so the workbook
 * can use that fund's 三级 tags. Futures sheets are absolute returns.
 * 今年以来 is not 近一年.
 */

import { readFile } from "fs/promises"
import * as XLSX from "xlsx"
import { query } from "@/lib/db"
import {
  emptyXiaohePeriods,
  imaDisplayName,
  indexXiaoheCatalog,
  isXiaoheIndexName,
  matchXiaoheCatalog,
  mergeXiaoheComparable,
  parseImaRankGrid,
  parseXiaoheOcrGrid,
  xiaoheNameKey,
  xiaoheOcrComparable,
  type ImaRankRow,
  type XiaoheCatalogHit,
  type XiaoheComparable,
  type XiaoheOcrRow,
} from "@/lib/ma/xiaohe-weekly-rows"
import { imaManagerKey } from "@/lib/ma/ima-weekly-metrics"
import { beianFamilyKey } from "@/lib/server/share-class-product"
import { getKnowledgeBaseFile } from "@/lib/server/knowledge-base"
import { loadExternalRankWeekFiles } from "@/lib/server/external-rank-week"
import {
  computeFundMetrics,
  type FundMetrics,
  type WeeklyReviewFund,
} from "@/lib/server/jy-weekly-review"

export type FuturesExternalSource = "xiaohe" | "ima"

export type FuturesExternalRow = {
  source: FuturesExternalSource
  metrics: FundMetrics
  nameKey: string
  l2: string
  l3: string | null
}

type FuturesFund = {
  beian: string
  name: string
  manager: string
  l2: string
  l3: string | null
}

/** 量化CTA / 主观CTA on an external board. Stock strategies stay on the equity workbook. */
export function futuresExternalFamily(strategy: string): "量化期货" | "主观期货" | null {
  const compact = strategy.replace(/\s+/g, "")
  if (!compact || compact === "未分类") return null
  if (/\d+\.\d+\d+\.\d+/.test(compact)) return null
  if (/主观(?:cta|期货)/i.test(compact)) return "主观期货"
  if (/量化(?:cta|期货)|管理期货/i.test(compact)) return "量化期货"
  if (/cta/i.test(compact)) return "量化期货"
  return null
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

function metricsFromMerged(name: string, beian: string, merged: XiaoheComparable): FundMetrics {
  return {
    beian_hao: beian,
    name,
    bucket: "",
    mode: "absolute",
    ret: { ...merged.ret },
    excess: { ...emptyXiaohePeriods() },
    excess_dd_6m: null,
    excess_dd_1y: null,
    sharpe_1y: merged.sharpe_1y,
    calmar_1y: merged.calmar_1y,
  }
}

async function readGridFiles(weekEnd: string, source: "files" | "ima"): Promise<unknown[][][]> {
  const files = await loadExternalRankWeekFiles(weekEnd, source)
  const grids: unknown[][][] = []
  for (const file of files) {
    try {
      const stored = await getKnowledgeBaseFile(file.path)
      const data = await readFile(stored.absolutePath)
      const workbook = XLSX.read(data, { type: "buffer", cellDates: true })
      for (const name of workbook.SheetNames) {
        const sheet = workbook.Sheets[name]
        if (!sheet) continue
        grids.push(XLSX.utils.sheet_to_json<unknown[]>(sheet, {
          header: 1,
          raw: true,
          defval: null,
          blankrows: false,
        }))
      }
    } catch (err) {
      console.error("[futures-weekly-external] file skipped:", file.name, err)
    }
  }
  return grids
}

async function loadFuturesFunds(): Promise<FuturesFund[]> {
  const products = await query<{
    beian_hao: string
    product_name: string
    short_name: string | null
    manager: string | null
    l2: string | null
    l3: string | null
  }>(
    `SELECT c.beian_hao,
            COALESCE(NULLIF(BTRIM(c.product_name), ''), c.beian_hao) AS product_name,
            NULLIF(BTRIM(c.short_name), '') AS short_name,
            i.manager,
            NULLIF(BTRIM(c.company_strategy_l2), '') AS l2,
            NULLIF(BTRIM(c.company_strategy_l3), '') AS l3
     FROM ops_tracking_funds_list_cache c
     LEFT JOIN private_fund_info i ON i.beian_hao = c.beian_hao
     WHERE c.company_strategy_l2 IN ('量化期货', '主观期货')
       AND COALESCE(BTRIM(c.beian_hao), '') <> ''`,
  )
  const byBeian = new Map<string, FuturesFund>()
  const funds: FuturesFund[] = []
  for (const row of products) {
    const l2 = (row.l2 || "").trim()
    if (l2 !== "量化期货" && l2 !== "主观期货") continue
    const fund: FuturesFund = {
      beian: row.beian_hao,
      name: row.product_name,
      manager: row.manager ?? "",
      l2,
      l3: row.l3,
    }
    if (!byBeian.has(fund.beian)) byBeian.set(fund.beian, fund)
    funds.push(fund)
    const shortName = (row.short_name || "").trim()
    if (shortName && shortName !== fund.name) funds.push({ ...fund, name: shortName })
  }
  return funds
}

function catalogOf(funds: FuturesFund[]): XiaoheCatalogHit[] {
  const hits: XiaoheCatalogHit[] = []
  for (const fund of funds) {
    const key = xiaoheNameKey(fund.name)
    if (!key) continue
    hits.push({ beian: fund.beian, name: fund.name, manager: fund.manager, key })
  }
  return hits
}

function preferFund(funds: FuturesFund[], poolFamilies: Set<string>): FuturesFund | null {
  if (funds.length === 0) return null
  const inPool = funds.filter((fund) => {
    const family = beianFamilyKey(fund.beian)
    return family != null && poolFamilies.has(family)
  })
  const list = inPool.length > 0 ? inPool : funds
  return list.find((fund) => /1号|一号/u.test(fund.name)) ?? list[0] ?? null
}

export async function loadFuturesExternalRows(
  weekEnd: string,
  poolFamilies: Set<string>,
): Promise<FuturesExternalRow[]> {
  const [grids, imaGrids, funds] = await Promise.all([
    readGridFiles(weekEnd, "files"),
    readGridFiles(weekEnd, "ima"),
    loadFuturesFunds().catch((err: unknown) => {
      console.error("[futures-weekly-external] fund catalog skipped:", err)
      return [] as FuturesFund[]
    }),
  ])
  if (funds.length === 0) return []
  const byBeian = new Map<string, FuturesFund>()
  for (const fund of funds) {
    if (!byBeian.has(fund.beian)) byBeian.set(fund.beian, fund)
  }
  const indexed = indexXiaoheCatalog(catalogOf(funds))
  const byManager = new Map<string, FuturesFund[]>()
  for (const fund of byBeian.values()) {
    const key = imaManagerKey(fund.manager)
    if (key.length < 2) continue
    const list = byManager.get(key) ?? []
    list.push(fund)
    byManager.set(key, list)
  }

  const xiaohePending: Array<{ fund: FuturesFund; published: XiaoheComparable; label: string }> = []
  const seenXiaohe = new Set<string>()
  const parsedXiaohe: XiaoheOcrRow[] = []
  for (const grid of grids) {
    const parsed = parseXiaoheOcrGrid(grid)
    if (parsed.kind === "absolute" || parsed.kind === "excess") parsedXiaohe.push(...parsed.rows)
  }
  for (const row of parsedXiaohe) {
    const family = futuresExternalFamily(row.strategy)
    if (!family || !row.product || isXiaoheIndexName(row.product)) continue
    const hit = matchXiaoheCatalog(row.product, row.manager, indexed.byKey, indexed.suffixIndex)
    const fund = hit ? byBeian.get(hit.beian) : undefined
    if (!fund || fund.l2 !== family || seenXiaohe.has(fund.beian)) continue
    seenXiaohe.add(fund.beian)
    xiaohePending.push({
      fund,
      published: xiaoheOcrComparable(row),
      label: row.product.trim() || fund.name,
    })
  }

  const imaPending: Array<{ fund: FuturesFund; published: XiaoheComparable; label: string }> = []
  const seenIma = new Set<string>()
  for (const grid of imaGrids) {
    for (const row of parseImaRankGrid(grid)) {
      const placed = placeImaRow(row, byManager, poolFamilies)
      if (!placed || seenIma.has(placed.beian)) continue
      seenIma.add(placed.beian)
      imaPending.push({
        fund: placed,
        published: xiaoheOcrComparable({
          product: imaDisplayName(row),
          manager: row.manager,
          strategy: row.strategy,
          ret: { ...emptyXiaohePeriods(), ret_1w: row.ret1w },
          excess1w: null,
        }),
        label: placed.name,
      })
    }
  }

  const selected = [...xiaohePending, ...imaPending]
  if (selected.length === 0) return []
  const uniqueFunds = new Map<string, WeeklyReviewFund>()
  for (const row of selected) {
    if (uniqueFunds.has(row.fund.beian)) continue
    uniqueFunds.set(row.fund.beian, {
      beian_hao: row.fund.beian,
      product_name: row.fund.name,
      short_name: null,
      l1: "期货策略",
      l2: row.fund.l2,
      l3: row.fund.l3,
    })
  }
  const computed = await computeFundMetrics([...uniqueFunds.values()], weekEnd, undefined, {
    bucketFor: () => "",
    modeFor: () => "absolute",
  }).catch((err: unknown) => {
    console.error("[futures-weekly-external] nav metrics skipped:", err)
    return [] as FundMetrics[]
  })
  const byCode = new Map(computed.map((row) => [row.beian_hao, row]))

  const out: FuturesExternalRow[] = []
  const emit = (source: FuturesExternalSource, row: { fund: FuturesFund; published: XiaoheComparable; label: string }) => {
    const database = byCode.get(row.fund.beian) ?? null
    const merged = mergeXiaoheComparable("absolute", database ? asComparable(database) : null, row.published)
    if (!merged) return
    out.push({
      source,
      metrics: metricsFromMerged(row.label, row.fund.beian, merged),
      nameKey: xiaoheNameKey(row.label),
      l2: row.fund.l2,
      l3: row.fund.l3,
    })
  }
  for (const row of xiaohePending) emit("xiaohe", row)
  for (const row of imaPending) emit("ima", row)
  return out
}

function placeImaRow(
  row: ImaRankRow,
  byManager: Map<string, FuturesFund[]>,
  poolFamilies: Set<string>,
): FuturesFund | null {
  const family = futuresExternalFamily(row.strategy)
  if (!family) return null
  const key = imaManagerKey(row.manager)
  if (key.length < 2) return null
  const funds = (byManager.get(key) ?? []).filter((fund) => fund.l2 === family)
  return preferFund(funds, poolFamilies)
}
