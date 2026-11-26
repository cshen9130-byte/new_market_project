/**
 * Product membership for 策略平均净值 universes.
 * Strategy tags still come from the same resolved classification as 市场全部.
 * Codes are uppercased 备案号.
 */

import { query } from "@/lib/db"
import { imaManagerKey, pickImaProduct, type ImaProductCandidate } from "@/lib/ma/ima-weekly-metrics"
import {
  parseImaRankGrid,
  xiaoheStrategyBucket,
  type ImaRankRow,
} from "@/lib/ma/xiaohe-weekly-rows"
import type {
  WeeklyReviewStrategyNavUniverse,
  WeeklyReviewStrategyNavVariant,
} from "@/lib/ma/weekly-review-strategy-nav"
import { beianFamilyKey } from "@/lib/server/share-class-product"
import { loadExternalRankWeekFiles } from "@/lib/server/external-rank-week"
import { getKnowledgeBaseFile } from "@/lib/server/knowledge-base"
import {
  sqlResolvedStrategyExprs,
  sqlType6LatestStrategyJoin,
} from "@/lib/server/fund-strategy-resolve"
import {
  bucketForFund,
  isEquityFund,
  loadJyTrackingPoolFunds,
  mondayOfWeek,
  type WeeklyReviewFund,
} from "@/lib/server/jy-weekly-review"
import { loadFuturesExternalRows } from "@/lib/server/futures-weekly-external-rows"
import { listHeldFofUnderlyingCodes } from "@/lib/server/weekly-review-invested-median"
import { listXiaoheWeeklyBeians } from "@/lib/server/xiaohe-weekly-rows"
import { WEEKLY_REVIEW_STATUS_HIDDEN_BUCKETS } from "@/lib/weekly-review-data-status"
import { readFile } from "fs/promises"
import * as XLSX from "xlsx"

function upperCode(code: string | null | undefined): string {
  return (code ?? "").trim().toUpperCase()
}

function asCodeSet(codes: Iterable<string>): Set<string> {
  const out = new Set<string>()
  for (const code of codes) {
    const key = upperCode(code)
    if (key) out.add(key)
  }
  return out
}

async function readImaRankRows(weekEnd: string): Promise<ImaRankRow[]> {
  const files = await loadExternalRankWeekFiles(weekEnd, "ima")
  const out: ImaRankRow[] = []
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
        out.push(...parseImaRankGrid(grid))
      }
    } catch (err) {
      console.error("[strategy-nav-universe] ima file skipped:", file.name, err)
    }
  }
  return out
}

type ImaCatalogRow = ImaProductCandidate & {
  manager: string
  bucket: string
}

async function loadImaEquityCatalog(): Promise<ImaCatalogRow[]> {
  const expr = sqlResolvedStrategyExprs("t6", "i")
  const rows = await query<{
    beian_hao: string
    product_name: string | null
    manager: string | null
    nav_date: string | null
    in_pool: boolean | string | number | null
    l1: string | null
    l2: string | null
    l3: string | null
  }>(
    `SELECT BTRIM(i.beian_hao) AS beian_hao,
            COALESCE(i.product_name, '') AS product_name,
            COALESCE(i.manager, '') AS manager,
            i.latest_nav_date::text AS nav_date,
            EXISTS (
              SELECT 1
              FROM tracking_pool p
              WHERE NULLIF(BTRIM(p.register_number), '') IS NOT NULL
                AND UPPER(BTRIM(p.register_number)) = UPPER(BTRIM(i.beian_hao))
            ) AS in_pool,
            ${expr.l1} AS l1,
            ${expr.l2} AS l2,
            ${expr.l3} AS l3
     FROM private_fund_info i
     ${sqlType6LatestStrategyJoin("i.beian_hao", "t6")}
     WHERE NULLIF(BTRIM(i.beian_hao), '') IS NOT NULL`,
  )
  const out: ImaCatalogRow[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const beian = upperCode(row.beian_hao)
    if (!beian || seen.has(beian)) continue
    const fund: WeeklyReviewFund = {
      beian_hao: row.beian_hao.trim(),
      product_name: row.product_name ?? "",
      short_name: null,
      l1: row.l1,
      l2: row.l2,
      l3: row.l3,
    }
    if (!isEquityFund(fund)) continue
    const bucket = bucketForFund(fund)
    if (!bucket || bucket === "未分类" || WEEKLY_REVIEW_STATUS_HIDDEN_BUCKETS.has(bucket)) continue
    seen.add(beian)
    const nav = (row.nav_date ?? "").slice(0, 10)
    out.push({
      beian: row.beian_hao.trim(),
      name: row.product_name ?? "",
      navDate: /^\d{4}-\d{2}-\d{2}$/.test(nav) ? nav : null,
      inPool: row.in_pool === true || row.in_pool === "t" || row.in_pool === 1 || row.in_pool === "1",
      manager: row.manager ?? "",
      bucket,
    })
  }
  return out
}

async function listImaEquityBeians(weekEnd: string): Promise<Set<string>> {
  const [rows, catalog] = await Promise.all([
    readImaRankRows(weekEnd),
    loadImaEquityCatalog().catch((err: unknown) => {
      console.error("[strategy-nav-universe] ima catalog skipped:", err)
      return [] as ImaCatalogRow[]
    }),
  ])
  if (rows.length === 0 || catalog.length === 0) return new Set()
  const byManager = new Map<string, ImaCatalogRow[]>()
  for (const fund of catalog) {
    const key = imaManagerKey(fund.manager)
    if (key.length < 2) continue
    const list = byManager.get(key) ?? []
    list.push(fund)
    byManager.set(key, list)
  }
  const weekStart = mondayOfWeek(weekEnd)
  const codes = new Set<string>()
  const seenPick = new Set<string>()
  for (const row of rows) {
    const bucket = xiaoheStrategyBucket(row.strategy)
    if (!bucket || WEEKLY_REVIEW_STATUS_HIDDEN_BUCKETS.has(bucket)) continue
    const key = imaManagerKey(row.manager)
    if (key.length < 2) continue
    const dedupe = `${bucket}\0${key}\0${row.pm.trim()}`
    if (seenPick.has(dedupe)) continue
    seenPick.add(dedupe)
    const candidates = (byManager.get(key) ?? []).filter((fund) => fund.bucket === bucket)
    const picked = pickImaProduct(candidates, row.pm, weekStart)
    if (picked) codes.add(upperCode(picked.beian))
  }
  return codes
}

async function listFuturesExternalBeians(weekEnd: string, source: "xiaohe" | "ima"): Promise<Set<string>> {
  const pool = await loadJyTrackingPoolFunds(["jy"]).catch((err: unknown) => {
    console.error("[strategy-nav-universe] tracking pool skipped:", err)
    return [] as Awaited<ReturnType<typeof loadJyTrackingPoolFunds>>
  })
  const poolFamilies = new Set<string>()
  for (const fund of pool) {
    const family = beianFamilyKey(fund.beian_hao)
    if (family) poolFamilies.add(family)
  }
  const rows = await loadFuturesExternalRows(weekEnd, poolFamilies).catch((err: unknown) => {
    console.error("[strategy-nav-universe] futures external rows skipped:", err)
    return [] as Awaited<ReturnType<typeof loadFuturesExternalRows>>
  })
  return asCodeSet(rows.filter((row) => row.source === source).map((row) => row.metrics.beian_hao))
}

export async function loadStrategyNavUniverseCodes(
  universe: Exclude<WeeklyReviewStrategyNavUniverse, "market">,
  variant: WeeklyReviewStrategyNavVariant,
  weekEnd: string,
): Promise<Set<string>> {
  if (universe === "tracking") {
    const funds = await loadJyTrackingPoolFunds(["jy"])
    return asCodeSet(funds.map((fund) => fund.beian_hao))
  }
  if (universe === "yt") {
    return asCodeSet(await listHeldFofUnderlyingCodes())
  }
  if (universe === "xiaohe") {
    if (variant === "futures") return listFuturesExternalBeians(weekEnd, "xiaohe")
    return asCodeSet(await listXiaoheWeeklyBeians(weekEnd))
  }
  if (variant === "futures") return listFuturesExternalBeians(weekEnd, "ima")
  return listImaEquityBeians(weekEnd)
}
