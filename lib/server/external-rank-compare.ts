/**
 * Compare a ranking workbook in the knowledge base with one strategy class
 * inside the tracking pools. Our returns are recomputed from the same NAV
 * series the weekly review uses, through the file's own as-of date.
 */

import { readFile } from "fs/promises"
import { query } from "@/lib/db"
import { normalizeWeeklyReviewPools, weeklyReviewPoolScopePhrase } from "@/lib/ma/weekly-review-pools"
import { addDays, calcReturn, type NavPoint } from "@/lib/server/list-cache-nav-batch"
import {
  bucketForFund,
  collapseWeeklyReviewFunds,
  displayName,
  loadJyTrackingPoolFunds,
  loadWeeklyReviewNavCoverage,
  loadWeeklyReviewNavHistories,
  mondayOfWeek,
  type WeeklyReviewFund,
} from "@/lib/server/jy-weekly-review"
import { bucketForFuturesFund } from "@/lib/server/jy-weekly-review-futures"
import { getKnowledgeBaseFile, listKnowledgeBaseIndexableFiles } from "@/lib/server/knowledge-base"
import {
  buildExternalRankComparison,
  fundInRankClass,
  parseExternalRankWorkbook,
  resolveRankClass,
  rowMatchesRankClass,
  selectParsedClass,
  type ExternalRankComparison,
  type ParsedExternalRank,
  type PoolRankProduct,
} from "@/lib/server/external-rank-sheet"

const RANK_FILE = /点睛|业绩榜|业绩放送|业绩排行|外部业绩榜/
const AUTO_JOIN_NOTE = "收益是百分数：159.12 表示 159.12%。their_* 来自榜单原表，our_* 用跟踪池产品的复权净值重算到榜单截止日，不读取周度回顾 Excel。our_return 是该管理人在池内、且属于这一策略的产品里最高的一条。rank_gap = 池内名次 - 榜单名次，正数表示按我们的净值它排得更靠后。needs_review 里的名称没有自动并进 both，对应的池内管理人仍会留在 pool_only。"

type RankFund = WeeklyReviewFund & { manager: string | null }

export type ExternalRankCompareResult = ExternalRankComparison & {
  file: {
    path: string
    name: string
    title: string
    as_of: string
    window_label: string
  }
  pools: string[]
  pool_label: string
  pool_product_count: number
  pool_manager_count: number
  as_of_gap_days: number | null
  window_note: string
  also_found: string[]
}

function pointValue(point: NavPoint): number | null {
  const value = point.return_nav ?? point.nav
  return Number.isFinite(value) && value > 0 ? value : null
}

function onOrBefore(points: NavPoint[], date: string): { date: string; value: number } | null {
  let best: { date: string; value: number } | null = null
  for (const point of points) {
    if (point.nav_date > date) continue
    const value = pointValue(point)
    if (value == null) continue
    if (!best || point.nav_date > best.date) best = { date: point.nav_date, value }
  }
  return best
}

function windowReturn(points: NavPoint[], asOf: string, kind: "ytd" | "1y"): number | null {
  const end = onOrBefore(points, asOf)
  if (!end) return null
  const startDate = kind === "ytd" ? `${Number(asOf.slice(0, 4)) - 1}-12-31` : addDays(asOf, 365)
  const start = onOrBefore(points, startDate)
  if (!start || start.date >= end.date) return null
  return calcReturn(end.value, start.value)
}

function weekReturn(points: NavPoint[], asOf: string): number | null {
  const end = onOrBefore(points, asOf)
  if (!end || end.date < mondayOfWeek(asOf)) return null
  const start = onOrBefore(points, addDays(asOf, 7))
  if (!start || start.date >= end.date) return null
  return calcReturn(end.value, start.value)
}

function gapDays(later: string, earlier: string): number {
  const ms = Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}

function parsedHasClass(parsed: ParsedExternalRank, classKey: string): boolean {
  return parsed.rows.some((row) => rowMatchesRankClass(row, classKey))
}

async function loadRankFunds(poolsInput: string): Promise<RankFund[]> {
  const pools = normalizeWeeklyReviewPools(poolsInput)
  const base = await loadJyTrackingPoolFunds(pools)
  if (base.length === 0) return []
  const codes = base.map((fund) => fund.beian_hao.trim()).filter(Boolean)
  const rows = await query<{ beian_hao: string; manager: string | null }>(
    `SELECT UPPER(BTRIM(codes.beian_hao)) AS beian_hao,
            COALESCE(
              NULLIF(BTRIM(i.manager), ''),
              NULLIF(BTRIM(a.manager_name), ''),
              NULLIF(BTRIM(b.investment_advisor), '')
            ) AS manager
     FROM unnest($1::text[]) AS codes(beian_hao)
     LEFT JOIN private_fund_info i ON UPPER(BTRIM(i.beian_hao)) = UPPER(BTRIM(codes.beian_hao))
     LEFT JOIN amac_private_funds a ON UPPER(BTRIM(a.fund_no)) = UPPER(BTRIM(codes.beian_hao))
     LEFT JOIN private_fund_info_bfl b ON UPPER(BTRIM(b.beian_hao)) = UPPER(BTRIM(codes.beian_hao))`,
    [codes],
  )
  const managerByCode = new Map(rows.map((row) => [row.beian_hao.toUpperCase(), row.manager]))
  return base.map((fund) => ({
    ...fund,
    manager: managerByCode.get(fund.beian_hao.trim().toUpperCase()) ?? null,
  }))
}

function bucketFor(fund: RankFund, classKeys: string[]): string {
  const futures = classKeys.every((key) => key === "量化CTA" || key === "主观CTA" || key === "量化期货" || key === "主观期货")
  if (futures) return bucketForFuturesFund(fund)
  return bucketForFund(fund)
}

async function poolProducts(funds: RankFund[], classKeys: string[], asOf: string, kind: "ytd" | "1y"): Promise<PoolRankProduct[]> {
  const matched = funds.filter((fund) => classKeys.some((key) => fundInRankClass(fund, key)))
  if (matched.length === 0) return []
  const coverage = await loadWeeklyReviewNavCoverage(matched, asOf)
  const collapsed = collapseWeeklyReviewFunds(matched, coverage) as RankFund[]
  const histories = await loadWeeklyReviewNavHistories(collapsed, asOf)
  return collapsed.map((fund) => {
    const history = histories.get(fund.beian_hao) ?? []
    return {
      beian_hao: fund.beian_hao,
      name: displayName(fund.product_name, fund.short_name, fund.beian_hao),
      manager: fund.manager,
      bucket: bucketFor(fund, classKeys),
      l1: fund.l1,
      l2: fund.l2,
      l3: fund.l3,
      ytd: windowReturn(history, asOf, kind),
      ret_1w: weekReturn(history, asOf),
    }
  })
}

async function readRankFile(relativePath: string): Promise<{ relativePath: string; name: string; data: Buffer }> {
  const file = await getKnowledgeBaseFile(relativePath)
  if (file.extension !== ".xlsx" && file.extension !== ".xls") {
    throw new Error("业绩榜需要是 xlsx 或 xls")
  }
  const data = await readFile(file.absolutePath)
  return { relativePath: file.relativePath, name: file.name, data }
}

async function chooseRankFile(classKey: string | null, filePath: string): Promise<{
  relativePath: string
  name: string
  parsed: ParsedExternalRank
  alsoFound: string[]
}> {
  if (filePath) {
    const file = await readRankFile(filePath)
    const parsed = parseExternalRankWorkbook(file.data, file.relativePath)
    return { relativePath: file.relativePath, name: file.name, parsed, alsoFound: [] }
  }

  const listed = await listKnowledgeBaseIndexableFiles("")
  const candidates = listed.filter((file) => /\.xlsx?$/i.test(file.relativePath) && RANK_FILE.test(file.relativePath))
  if (candidates.length === 0) {
    throw new Error("知识库里没有点睛业绩榜。请上传 xlsx，文件名保留「点睛」或「业绩榜」，或用 file_path 指定路径")
  }

  const parsedFiles: Array<{ relativePath: string; name: string; parsed: ParsedExternalRank }> = []
  for (const candidate of candidates) {
    try {
      const file = await readRankFile(candidate.relativePath)
      const parsed = parseExternalRankWorkbook(file.data, file.relativePath)
      if (classKey && !parsedHasClass(parsed, classKey)) continue
      parsedFiles.push({ relativePath: file.relativePath, name: file.name, parsed })
    } catch {
      continue
    }
  }
  if (parsedFiles.length === 0) {
    throw new Error(classKey
      ? `知识库的业绩榜里没有「${classKey}」。可以用 file_path 指定文件`
      : "知识库里的业绩榜无法解析。请确认表头含基金管理人或产品名称，以及收益率")
  }
  parsedFiles.sort((a, b) => b.parsed.as_of.localeCompare(a.parsed.as_of) || b.relativePath.localeCompare(a.relativePath))
  const chosen = parsedFiles[0]
  return {
    relativePath: chosen.relativePath,
    name: chosen.name,
    parsed: chosen.parsed,
    alsoFound: parsedFiles.slice(1, 8).map((file) => file.relativePath),
  }
}

export async function compareExternalRank(input: {
  className?: string
  filePath?: string
  pools?: string
  weekEnd?: string
  topN?: number
}): Promise<ExternalRankCompareResult> {
  const requested = input.className ? resolveRankClass(input.className) : null
  if (input.className && !requested) {
    throw new Error("class 请填主观多头、量化股票、量化CTA、主观CTA，或具体分组如 500指增")
  }
  const pools = normalizeWeeklyReviewPools(input.pools)
  const chosen = await chooseRankFile(requested, (input.filePath || "").trim())
  const selected = selectParsedClass(chosen.parsed, requested)
  const topN = input.topN && input.topN > 0 ? Math.min(100, Math.floor(input.topN)) : 30
  const funds = await loadRankFunds(pools.join(","))
  const products = await poolProducts(funds, selected.classKeys, chosen.parsed.as_of, chosen.parsed.window)
  const comparison = buildExternalRankComparison(
    selected.rows,
    selected.classKey,
    products,
    topN,
    chosen.parsed.window,
    chosen.parsed.as_of,
  )
  const weekEnd = (input.weekEnd || "").trim()
  const asOfGap = /^\d{4}-\d{2}-\d{2}$/.test(weekEnd) ? gapDays(weekEnd, chosen.parsed.as_of) : null
  const gapNote = asOfGap != null && Math.abs(asOfGap) > 10
    ? `传入的 week_end ${weekEnd} 与榜单截止日相差 ${Math.abs(asOfGap)} 天，对比仍按榜单截止日 ${chosen.parsed.as_of}。`
    : ""
  const emptyPool = products.length === 0
    ? `${weeklyReviewPoolScopePhrase(pools)}里没有「${selected.classKey}」产品。`
    : ""
  const managers = new Set(products.map((product) => (product.manager || "").trim()).filter(Boolean))

  return {
    ...comparison,
    file: {
      path: chosen.relativePath,
      name: chosen.name,
      title: chosen.parsed.title,
      as_of: chosen.parsed.as_of,
      window_label: chosen.parsed.window_label,
    },
    pools,
    pool_label: weeklyReviewPoolScopePhrase(pools),
    pool_product_count: products.length,
    pool_manager_count: managers.size,
    as_of_gap_days: asOfGap,
    window_note: [AUTO_JOIN_NOTE, emptyPool, gapNote].filter(Boolean).join(""),
    also_found: chosen.alsoFound,
  }
}
