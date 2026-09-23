import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { ChatOpenAI } from "@langchain/openai"
import { HumanMessage, SystemMessage } from "@langchain/core/messages"
import {
  formatFundStrategyLabel,
  sqlResolvedStrategySelect,
  sqlType6LatestStrategyJoin,
  sqlType6TableResolvedStrategy,
} from "@/lib/server/fund-strategy-resolve"
import {
  addDays,
  BatchNavResolver,
  expandBeiansWithShareClassFamily,
  NAV_HISTORY_LOOKBACK_DAYS,
  type ProductNavIdentity,
} from "@/lib/server/list-cache-nav-batch"
import { fundNameKey, shareClassProductCodesMatch, sqlFundNameKey } from "@/lib/server/fund-name-match"
import { loadFundNavSeries, resolveFundNames } from "@/lib/server/fund-nav-series"
import {
  buildTieredBeianCode,
  buildTieredFullName,
  shareClassFromProductName,
  type ShareClassLetter,
} from "@/lib/server/share-class-product"
import { teamNavBeianLookupCodes } from "@/lib/server/team-nav-manage-pg"
import {
  MAX_SIMILAR_FUND_MATERIAL_FILES,
  applyUserNoteToMaterials,
  extractNoteSearchTokens,
  inferStrategyFromUserNote,
  isWeakMaterialIdentity,
  looksLikeFundIdentity,
  parseSimilarFundMaterials,
  downsampleInterpolatedChartNav,
  extendChartPastLastAxisTick,
  similarFundMaterialKindLabel,
  type SimilarFundMaterialProfile,
  type SimilarFundNavPoint,
} from "@/lib/server/similar-fund-materials"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

// ── LLM helpers ────────────────────────────────────────────────────────────────

function getChatModel(streaming = false) {
  const apiKey = process.env.DASHSCOPE_API_KEY
  if (!apiKey) throw new Error("缺少 DASHSCOPE_API_KEY")
  return new ChatOpenAI({
    apiKey,
    model: process.env.DASHSCOPE_CHAT_MODEL || "qwen-plus",
    temperature: 0.3,
    streaming,
    configuration: {
      baseURL: process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
  })
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => { console.warn(`[similar-fund] ${label} timed out`); resolve(fallback) }, ms)),
  ])
}

// ── Types ───────────────────────────────────────────────────────────────────────

interface FundInfo {
  beian_hao: string
  product_name: string
  manager: string
  strategy_l1: string | null
  strategy_l2: string | null
  strategy_l3: string | null
  inception_date: string | null
  ret_1w: string | null
  ret_1m: string | null
  ret_3m: string | null
  ret_6m: string | null
  ret_1y: string | null
  sharpe_1y: string | null
  calmar_1y: string | null
  latest_nav: string | null
  latest_nav_date: string | null
}

interface NavPoint {
  price_date: string
  nav: string
  cumulative_nav: string | null
}

interface SimilarityResult {
  fund: FundInfo
  score: number
  correlation: number | null
  metricScore: number | null
  overlapMonths: number
  navPoints: number
  /** Mean squared unit-NAV difference on exact shared dates. Lower is a closer level match. */
  levelResidual: number | null
  /** Exact-date unit-NAV pairs used for correlation. Thin overlap can fake ~1.00 Pearson. */
  alignedExact: number
  nav: NavPoint[]
}

// ── DB helpers ─────────────────────────────────────────────────────────────────

const RISK_CACHE_JOIN = `LEFT JOIN ops_tracking_funds_list_cache cache
       ON UPPER(BTRIM(cache.beian_hao)) = UPPER(BTRIM(i.beian_hao))`

const FUND_INFO_SELECT = `
       i.beian_hao, i.product_name, i.manager,
       ${sqlResolvedStrategySelect("i")},
       i.inception_date::text AS inception_date,
       i.ret_1w::text, i.ret_1m::text, i.ret_3m::text, i.ret_6m::text, i.ret_1y::text,
       COALESCE(i.sharpe_1y, cache.sharpe_1y)::text AS sharpe_1y,
       COALESCE(i.calmar_1y, cache.calmar_1y)::text AS calmar_1y,
       i.latest_nav::text, i.latest_nav_date::text AS latest_nav_date`

const FUND_INFO_SELECT_LITE = `
       i.beian_hao, i.product_name, i.manager,
       i.strategy_l1, i.strategy_l2, NULL::text AS strategy_l3,
       i.inception_date::text AS inception_date,
       i.ret_1w::text, i.ret_1m::text, i.ret_3m::text, i.ret_6m::text, i.ret_1y::text,
       i.sharpe_1y::text AS sharpe_1y, i.calmar_1y::text AS calmar_1y,
       i.latest_nav::text, i.latest_nav_date::text AS latest_nav_date`

function isDbUnreachable(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err)
  return /ECONNREFUSED|connect ETIMEDOUT|connect ECONNRESET/i.test(msg)
}

function dbErrorMessage(err: unknown): string {
  const msg = String((err as Error)?.message ?? err)
  if (isDbUnreachable(err)) {
    return `数据库无法连接（127.0.0.1:5433）。相似匹配需要库内净值，请先打开 SSH 隧道后再试。`
  }
  return msg
}

function rethrowIfDbDown(err: unknown, label: string): void {
  console.warn(`[similar-fund] ${label}`, err)
  if (isDbUnreachable(err)) {
    throw new Error(dbErrorMessage(err))
  }
}

function strategyLabel(fund: Pick<FundInfo, "strategy_l1" | "strategy_l2" | "strategy_l3">): string {
  return formatFundStrategyLabel(fund.strategy_l1, fund.strategy_l2, fund.strategy_l3)
}

async function fetchFundByName(subject: string): Promise<FundInfo | null> {
  const s = subject.trim()
  if (!s) return null
  const key = fundNameKey(s)
  const letter = shareClassFromProductName(s)
  const infoRows = await query<FundInfo>(
    `SELECT ${FUND_INFO_SELECT}
     FROM private_fund_info i
     ${sqlType6LatestStrategyJoin("i.beian_hao")}
     ${RISK_CACHE_JOIN}
     WHERE i.product_name ILIKE $1 OR i.beian_hao ILIKE $1 OR i.manager ILIKE $1
        OR ($2::text IS NOT NULL AND ${sqlFundNameKey("i.product_name")} = $2)
     ORDER BY
       CASE
         WHEN i.product_name = $3 THEN 0
         WHEN $2::text IS NOT NULL AND ${sqlFundNameKey("i.product_name")} = $2 THEN 1
         ELSE 2
       END,
       i.product_name
     LIMIT 8`,
    [`%${s}%`, key, s],
  )
  const exactInfo = infoRows.find((f) => f.product_name === s)
  if (exactInfo && !letter) return exactInfo

  const parent = exactInfo
    ?? infoRows.find((f) => key && fundNameKey(f.product_name) === key)
    ?? infoRows[0]
    ?? null
  if (letter && parent) {
    const shareCode = buildTieredBeianCode(parent.beian_hao, letter)
    const shareFunds = await fetchFundsForNavCodes([shareCode])
    const share = shareFunds.find((f) => f.beian_hao.trim().toUpperCase() === shareCode)
      ?? shareFunds[0]
    if (share) {
      return {
        ...parent,
        ...share,
        manager: share.manager || parent.manager,
        strategy_l1: share.strategy_l1 ?? parent.strategy_l1,
        strategy_l2: share.strategy_l2 ?? parent.strategy_l2,
        strategy_l3: share.strategy_l3 ?? parent.strategy_l3,
        product_name: share.product_name || buildTieredFullName(parent.product_name, letter),
      }
    }
  }
  if (parent) return parent

  const bfl = await query<{ beian_hao: string; product_name: string | null }>(
    `SELECT beian_hao, product_name
     FROM private_fund_info_bfl
     WHERE product_name ILIKE $1 OR UPPER(BTRIM(beian_hao)) = UPPER(BTRIM($3))
        OR ($2::text IS NOT NULL AND ${sqlFundNameKey("product_name")} = $2)
     ORDER BY CASE WHEN product_name = $3 THEN 0 ELSE 1 END
     LIMIT 5`,
    [`%${s}%`, key, s],
  ).catch(() => [] as { beian_hao: string; product_name: string | null }[])
  const bflHit = bfl.find((r) => r.product_name === s) ?? bfl[0]
  if (bflHit) {
    const funds = await fetchFundsForNavCodes([bflHit.beian_hao])
    return funds[0] ?? emptyFundMetrics({
      beian_hao: bflHit.beian_hao,
      product_name: bflHit.product_name?.trim() || bflHit.beian_hao,
    })
  }
  return null
}

async function fetchFundByBeian(beian: string): Promise<FundInfo | null> {
  const code = beian.trim()
  if (!code) return null
  const rows = await query<FundInfo>(
    `SELECT ${FUND_INFO_SELECT}
     FROM private_fund_info i
     ${sqlType6LatestStrategyJoin("i.beian_hao")}
     ${RISK_CACHE_JOIN}
     WHERE UPPER(BTRIM(i.beian_hao)) = UPPER(BTRIM($1))
     LIMIT 1`,
    [code],
  )
  return rows[0] ?? null
}

async function resolveTargetFund(
  subject: string,
  materials: SimilarFundMaterialProfile | null,
  namedFund: boolean,
  beianHao = "",
): Promise<FundInfo | null> {
  if (namedFund) {
    const code = beianHao.trim() || subject.trim()
    if (code) {
      const byCode = await fetchFundByBeian(code)
      if (byCode) return byCode
      const fromNavCodes = await fetchFundsForNavCodes([code])
      if (fromNavCodes[0] && fromNavCodes[0].beian_hao.trim().toUpperCase() === code.trim().toUpperCase()) {
        return fromNavCodes[0]
      }
    }
    if (subject.trim() && !isWeakMaterialIdentity(subject)) {
      const byName = await fetchFundByName(subject)
      if (byName) return byName
    }
  }
  if (materials?.beianHao) {
    const byCode = await fetchFundByBeian(materials.beianHao)
    if (byCode) return byCode
  }
  if (materials?.productName && looksLikeFundIdentity(materials.productName)) {
    const byName = await fetchFundByName(materials.productName)
    if (byName) return byName
  }
  return null
}

function emptyFundMetrics(partial: Pick<FundInfo, "beian_hao" | "product_name"> & Partial<FundInfo>): FundInfo {
  return {
    manager: "",
    strategy_l1: null,
    strategy_l2: null,
    strategy_l3: null,
    inception_date: null,
    ret_1w: null,
    ret_1m: null,
    ret_3m: null,
    ret_6m: null,
    ret_1y: null,
    sharpe_1y: null,
    calmar_1y: null,
    latest_nav: null,
    latest_nav_date: null,
    ...partial,
  }
}

/**
 * For pure-curve-upload mode: find candidates by querying private_fund_nav
 * directly (the fof99 data), ordered by how closely the fund's nav record
 * count matches the uploaded series record count.  This catches funds like
 * SAFP31 whose data density (weekly) matches the upload precisely.
 */
async function fetchPoolFromNavTable(
  fromDate: string,
  toDate: string,
  excludeBeian: string,
  limit = 400,
  targetNavCount = 0,
): Promise<FundInfo[]> {
  const exclude = excludeBeian.trim()
  const days = (Date.parse(toDate) - Date.parse(fromDate)) / 86_400_000
  const weeks = Math.max(8, Math.round(days / 7))
  // Month-end ticks OR a densely digitized line should still retrieve weekly Friday series.
  const target = days >= 120 && (targetNavCount <= 16 || targetNavCount >= 80)
    ? weeks
    : (targetNavCount || 50)
  return query<FundInfo>(
    `WITH nav_counts AS (
       SELECT UPPER(BTRIM(beian_hao)) AS beian_hao, COUNT(*) AS cnt
       FROM private_fund_nav
       WHERE price_date BETWEEN $2::date AND $3::date
         AND nav IS NOT NULL AND nav > 0
         AND ($1::text = '' OR UPPER(BTRIM(beian_hao)) <> UPPER(BTRIM($1)))
       GROUP BY beian_hao
       HAVING COUNT(*) >= 4
     )
     SELECT ${FUND_INFO_SELECT_LITE}
     FROM private_fund_info i
     JOIN nav_counts nc ON UPPER(BTRIM(i.beian_hao)) = nc.beian_hao
     ORDER BY ABS(nc.cnt - $5::int) ASC, nc.cnt DESC
     LIMIT $4`,
    [exclude, fromDate, toDate, limit, target],
  ).catch((err) => {
    rethrowIfDbDown(err, "nav-table pool failed")
    return [] as FundInfo[]
  })
}

/** Resolve official / BFL / synthesized share-class rows for raw NAV/email/team codes. */
async function fetchFundsForNavCodes(codes: string[]): Promise<FundInfo[]> {
  const raw = [...new Set(codes.map((c) => c.trim().toUpperCase()).filter(Boolean))]
  const lookup = expandBeiansWithShareClassFamily(raw)
  if (lookup.length === 0) return []
  const official = await query<FundInfo>(
    `SELECT ${FUND_INFO_SELECT_LITE}
     FROM private_fund_info i
     WHERE UPPER(BTRIM(i.beian_hao)) = ANY($1::text[])`,
    [lookup],
  ).catch((err) => {
    rethrowIfDbDown(err, "nav-code fund lookup failed")
    return [] as FundInfo[]
  })
  const have = new Set(official.map((f) => f.beian_hao.trim().toUpperCase()))
  const missing = lookup.filter((c) => !have.has(c))
  let bfl: FundInfo[] = []
  if (missing.length) {
    const rows = await query<{ beian_hao: string; product_name: string | null }>(
      `SELECT beian_hao, product_name
       FROM private_fund_info_bfl
       WHERE UPPER(BTRIM(beian_hao)) = ANY($1::text[])`,
      [missing],
    ).catch(() => [] as { beian_hao: string; product_name: string | null }[])
    bfl = rows.map((r) => emptyFundMetrics({
      beian_hao: r.beian_hao,
      product_name: r.product_name?.trim() || r.beian_hao,
    }))
    for (const fund of bfl) have.add(fund.beian_hao.trim().toUpperCase())
  }
  const all = [...official, ...bfl]
  const extras: FundInfo[] = []
  for (const code of raw) {
    if (have.has(code)) continue
    const letter = /[ABC]$/u.test(code) ? code.slice(-1) as ShareClassLetter : null
    if (!letter) continue
    const parent = all.find((f) => {
      const key = f.beian_hao.trim().toUpperCase()
      return shareClassProductCodesMatch(code, key) && !/[ABC]$/u.test(key)
    }) ?? all.find((f) => shareClassProductCodesMatch(code, f.beian_hao))
    extras.push(emptyFundMetrics({
      beian_hao: code,
      product_name: parent ? buildTieredFullName(parent.product_name, letter) : code,
      manager: parent?.manager ?? "",
      strategy_l1: parent?.strategy_l1 ?? null,
      strategy_l2: parent?.strategy_l2 ?? null,
      strategy_l3: parent?.strategy_l3 ?? null,
    }))
    have.add(code)
  }
  return [...all, ...extras]
}

async function fetchPoolFromEmailNav(
  fromDate: string,
  toDate: string,
  excludeBeian: string,
  limit = 150,
  targetNavCount = 0,
): Promise<FundInfo[]> {
  const exclude = excludeBeian.trim()
  const target = targetNavCount || 20
  const counts = await query<{ code: string; cnt: number }>(
    `SELECT UPPER(BTRIM(product_code)) AS code, COUNT(*)::int AS cnt
     FROM ops_email_nav_records
     WHERE nav_date BETWEEN $2::date AND $3::date
       AND nav IS NOT NULL AND nav > 0
       AND product_code IS NOT NULL AND BTRIM(product_code) <> ''
       AND ($1::text = '' OR UPPER(BTRIM(product_code)) <> UPPER(BTRIM($1)))
     GROUP BY 1
     HAVING COUNT(*) >= 4
     ORDER BY ABS(COUNT(*) - $4::int) ASC, COUNT(*) DESC
     LIMIT 400`,
    [exclude, fromDate, toDate, target],
  ).catch((err) => {
    rethrowIfDbDown(err, "email-nav pool failed")
    return [] as { code: string; cnt: number }[]
  })
  if (counts.length === 0) return []
  const funds = await fetchFundsForNavCodes(counts.map((c) => c.code))
  const scored = funds.map((fund) => {
    const family = new Set(expandBeiansWithShareClassFamily([fund.beian_hao]))
    const matched = counts.filter((c) => family.has(c.code) || shareClassProductCodesMatch(c.code, fund.beian_hao))
    const cnt = matched.reduce((best, row) => {
      if (best == null || Math.abs(row.cnt - target) < Math.abs(best - target)) return row.cnt
      return best
    }, null as number | null) ?? 0
    return { fund, gap: Math.abs(cnt - target), cnt }
  })
  scored.sort((a, b) => a.gap - b.gap || b.cnt - a.cnt)
  return scored.slice(0, limit).map((s) => s.fund)
}

async function fetchPoolFromTeamNav(
  fromDate: string,
  toDate: string,
  excludeBeian: string,
  limit = 80,
  targetNavCount = 0,
): Promise<FundInfo[]> {
  const exclude = excludeBeian.trim()
  const target = targetNavCount || 20
  const counts = await query<{ code: string; cnt: number }>(
    `SELECT UPPER(BTRIM(beian_hao)) AS code, COUNT(*)::int AS cnt
     FROM ops_team_nav_manual
     WHERE nav_date BETWEEN $2::date AND $3::date
       AND unit_nav IS NOT NULL AND unit_nav > 0
       AND nav_type = 'pre_fee'
       AND ($1::text = '' OR UPPER(BTRIM(beian_hao)) <> UPPER(BTRIM($1)))
     GROUP BY 1
     HAVING COUNT(*) >= 4
     ORDER BY ABS(COUNT(*) - $4::int) ASC, COUNT(*) DESC
     LIMIT 200`,
    [exclude, fromDate, toDate, target],
  ).catch((err) => {
    rethrowIfDbDown(err, "team-nav pool failed")
    return [] as { code: string; cnt: number }[]
  })
  if (counts.length === 0) return []
  const funds = await fetchFundsForNavCodes(counts.map((c) => c.code))
  const scored = funds.map((fund) => {
    const family = new Set([
      fund.beian_hao.trim().toUpperCase(),
      ...teamNavBeianLookupCodes(fund.beian_hao),
    ])
    const matched = counts.filter((c) => family.has(c.code) || shareClassProductCodesMatch(c.code, fund.beian_hao))
    const cnt = matched.reduce((best, row) => {
      if (best == null || Math.abs(row.cnt - target) < Math.abs(best - target)) return row.cnt
      return best
    }, null as number | null) ?? 0
    return { fund, gap: Math.abs(cnt - target), cnt }
  })
  scored.sort((a, b) => a.gap - b.gap || b.cnt - a.cnt)
  return scored.slice(0, limit).map((s) => s.fund)
}

/** Funds whose merged nav window and point count match the upload. */
async function fetchPoolByAlignedWindow(
  fromDate: string,
  toDate: string,
  excludeBeian: string,
  uploadedNavCount: number,
  limit = 200,
): Promise<FundInfo[]> {
  const exclude = excludeBeian.trim()
  const n = uploadedNavCount || 50
  const slack = Math.max(5, Math.floor(n * 0.25))
  return query<FundInfo>(
    `WITH u AS (
       SELECT UPPER(BTRIM(beian_hao)) AS beian_hao, price_date::date AS price_date
       FROM private_fund_nav
       WHERE price_date BETWEEN $2::date AND $3::date AND nav IS NOT NULL AND nav > 0
       UNION
       SELECT UPPER(BTRIM(beian_hao)), price_date::date
       FROM private_fund_nav_group
       WHERE price_date BETWEEN $2::date AND $3::date AND nav IS NOT NULL AND nav > 0
       UNION
       SELECT UPPER(BTRIM(beian_hao)), price_date::date
       FROM private_fund_nav_group_type6
       WHERE price_date BETWEEN $2::date AND $3::date AND nav IS NOT NULL AND nav > 0
       UNION
       SELECT UPPER(BTRIM(product_code)), nav_date::date
       FROM ops_email_nav_records
       WHERE nav_date BETWEEN $2::date AND $3::date AND nav IS NOT NULL AND nav > 0
         AND product_code IS NOT NULL AND BTRIM(product_code) <> ''
       UNION
       SELECT UPPER(BTRIM(beian_hao)), nav_date::date
       FROM ops_team_nav_manual
       WHERE nav_date BETWEEN $2::date AND $3::date AND unit_nav IS NOT NULL AND unit_nav > 0
         AND nav_type = 'pre_fee'
     ),
     agg AS (
       SELECT beian_hao, COUNT(*)::int AS cnt, MIN(price_date) AS mn, MAX(price_date) AS mx
       FROM u GROUP BY beian_hao
     )
     SELECT ${FUND_INFO_SELECT_LITE}
     FROM private_fund_info i
     JOIN agg a ON UPPER(BTRIM(i.beian_hao)) = a.beian_hao
     WHERE ($1::text = '' OR UPPER(BTRIM(i.beian_hao)) <> UPPER(BTRIM($1)))
       AND a.mn <= $2::date + 21 AND a.mx >= $3::date - 21
       AND ABS(a.cnt - $5::int) <= $6
     ORDER BY ABS(a.cnt - $5::int) ASC, ABS((a.mx - a.mn) - ($3::date - $2::date)) ASC
     LIMIT $4`,
    [exclude, fromDate, toDate, limit, n, slack],
  ).catch((err) => {
    rethrowIfDbDown(err, "aligned-window pool failed")
    return [] as FundInfo[]
  })
}

/** Same calendar span as the upload, even if print count differs (weekly vs OCR month-ends). */
async function fetchPoolByDateSpan(
  fromDate: string,
  toDate: string,
  excludeBeian: string,
  limit = 200,
): Promise<FundInfo[]> {
  const exclude = excludeBeian.trim()
  return query<FundInfo>(
    `WITH agg AS (
       SELECT UPPER(BTRIM(beian_hao)) AS beian_hao, MIN(price_date) AS mn, MAX(price_date) AS mx
       FROM private_fund_nav
       WHERE price_date BETWEEN $2::date AND $3::date AND nav IS NOT NULL AND nav > 0
       GROUP BY 1
       HAVING COUNT(*) >= 4
     )
     SELECT ${FUND_INFO_SELECT_LITE}
     FROM private_fund_info i
     JOIN agg a ON UPPER(BTRIM(i.beian_hao)) = a.beian_hao
     WHERE ($1::text = '' OR UPPER(BTRIM(i.beian_hao)) <> UPPER(BTRIM($1)))
       AND a.mn <= $2::date + 21 AND a.mx >= $3::date - 21
     ORDER BY (ABS(a.mn - $2::date) + ABS(a.mx - $3::date)) ASC
     LIMIT $4`,
    [exclude, fromDate, toDate, limit],
  ).catch((err) => {
    rethrowIfDbDown(err, "date-span pool failed")
    return [] as FundInfo[]
  })
}

/**
 * Funds whose unit NAV on the upload's first and last dates is close to the
 * uploaded curve. This is date-aligned level matching, not an identity lookup.
 */
async function fetchPoolByEndpointLevels(
  firstDate: string,
  lastDate: string,
  firstNav: number,
  lastNav: number,
  excludeBeian: string,
  limit = 80,
): Promise<FundInfo[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDate) || !/^\d{4}-\d{2}-\d{2}$/.test(lastDate)) return []
  if (!(firstNav > 0) || !(lastNav > 0)) return []
  const exclude = excludeBeian.trim()
  const hits = await query<{ beian_hao: string; first_v: number; last_v: number }>(
    `WITH pts AS (
       SELECT UPPER(BTRIM(beian_hao)) AS beian_hao, price_date::date AS price_date, nav::float8 AS nav
       FROM private_fund_nav WHERE price_date IN ($2::date, $3::date) AND nav IS NOT NULL AND nav > 0
       UNION ALL
       SELECT UPPER(BTRIM(beian_hao)), price_date::date, nav::float8
       FROM private_fund_nav_group WHERE price_date IN ($2::date, $3::date) AND nav IS NOT NULL AND nav > 0
       UNION ALL
       SELECT UPPER(BTRIM(beian_hao)), price_date::date, nav::float8
       FROM private_fund_nav_group_type6 WHERE price_date IN ($2::date, $3::date) AND nav IS NOT NULL AND nav > 0
       UNION ALL
       SELECT UPPER(BTRIM(product_code)), nav_date::date, nav::float8
       FROM ops_email_nav_records
       WHERE nav_date IN ($2::date, $3::date) AND nav IS NOT NULL AND nav > 0
         AND product_code IS NOT NULL AND BTRIM(product_code) <> ''
       UNION ALL
       SELECT UPPER(BTRIM(beian_hao)), nav_date::date, unit_nav::float8
       FROM ops_team_nav_manual
       WHERE nav_date IN ($2::date, $3::date) AND unit_nav IS NOT NULL AND unit_nav > 0
         AND nav_type = 'pre_fee'
     ),
     scored AS (
       SELECT beian_hao,
              MIN(nav) FILTER (WHERE price_date = $2::date) AS first_v,
              MIN(nav) FILTER (WHERE price_date = $3::date) AS last_v
       FROM pts
       GROUP BY beian_hao
     )
     SELECT beian_hao, first_v, last_v
     FROM scored
     WHERE first_v IS NOT NULL AND last_v IS NOT NULL
       AND ABS(first_v - $4) / $4 < 0.03
       AND ABS(last_v - $5) / $5 < 0.03
       AND ($1::text = '' OR beian_hao <> UPPER(BTRIM($1)))
     ORDER BY ABS(first_v - $4) + ABS(last_v - $5)
     LIMIT 200`,
    [exclude, firstDate, lastDate, firstNav, lastNav],
  ).catch((err) => {
    rethrowIfDbDown(err, "endpoint-level pool failed")
    return [] as { beian_hao: string; first_v: number; last_v: number }[]
  })
  if (hits.length === 0) return []
  const funds = await fetchFundsForNavCodes(hits.map((h) => h.beian_hao))
  const ranked = funds.map((fund) => {
    const family = new Set(expandBeiansWithShareClassFamily([fund.beian_hao]))
    const hit = hits.find((h) => family.has(h.beian_hao) || shareClassProductCodesMatch(h.beian_hao, fund.beian_hao))
    const dist = hit ? Math.abs(hit.first_v - firstNav) + Math.abs(hit.last_v - lastNav) : 1e9
    return { fund, dist }
  })
  ranked.sort((a, b) => a.dist - b.dist)
  return ranked.slice(0, limit).map((r) => r.fund)
}

/** Funds that published NAV on the same dates as the upload — natural curve search, not a value fingerprint. */
async function fetchPoolBySharedDates(
  dates: string[],
  excludeBeian: string,
  limit = 200,
): Promise<FundInfo[]> {
  const sample = [...new Set(dates.map((d) => d.slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))]
  if (sample.length < 3) return []
  const pickedCore = sample.length <= 12
    ? sample
    : [sample[0], ...sample.filter((_, i) => i > 0 && i < sample.length - 1 && i % Math.ceil((sample.length - 2) / 8) === 0).slice(0, 8), sample[sample.length - 1]]
  const lastByMonth = new Map<string, string>()
  for (const d of dates) lastByMonth.set(d.slice(0, 7), d.slice(0, 10))
  const picked = [...new Set([...pickedCore, ...lastByMonth.values()])]
  const exclude = excludeBeian.trim()
  const minHits = Math.max(3, Math.ceil(pickedCore.length * 0.8))
  const [official, emailCodes, teamCodes] = await Promise.all([
    query<FundInfo>(
      `WITH hits AS (
         SELECT UPPER(BTRIM(beian_hao)) AS beian_hao, COUNT(DISTINCT price_date) AS hit
         FROM (
           SELECT beian_hao, price_date FROM private_fund_nav WHERE price_date = ANY($2::date[])
           UNION
           SELECT beian_hao, price_date FROM private_fund_nav_group WHERE price_date = ANY($2::date[])
           UNION
           SELECT beian_hao, price_date FROM private_fund_nav_group_type6 WHERE price_date = ANY($2::date[])
           UNION
           SELECT beian_hao, nav_date FROM ops_team_nav_manual
           WHERE nav_date = ANY($2::date[]) AND nav_type = 'pre_fee' AND unit_nav IS NOT NULL AND unit_nav > 0
         ) t
         WHERE ($1::text = '' OR UPPER(BTRIM(beian_hao)) <> UPPER(BTRIM($1)))
         GROUP BY 1
         HAVING COUNT(DISTINCT price_date) >= $3
       )
       SELECT ${FUND_INFO_SELECT_LITE}
       FROM private_fund_info i
       JOIN hits h ON UPPER(BTRIM(i.beian_hao)) = h.beian_hao
       ORDER BY h.hit DESC, i.beian_hao
       LIMIT $4`,
      [exclude, picked, minHits, Math.max(limit, 400)],
    ).catch((err) => {
      rethrowIfDbDown(err, "shared-date pool failed")
      return [] as FundInfo[]
    }),
    query<{ code: string }>(
      `SELECT UPPER(BTRIM(product_code)) AS code
       FROM ops_email_nav_records
       WHERE nav_date = ANY($1::date[])
         AND product_code IS NOT NULL AND BTRIM(product_code) <> ''
       GROUP BY 1
       HAVING COUNT(DISTINCT nav_date) >= $2`,
      [picked, minHits],
    ).catch(() => [] as { code: string }[]),
    query<{ code: string }>(
      `SELECT UPPER(BTRIM(beian_hao)) AS code
       FROM ops_team_nav_manual
       WHERE nav_date = ANY($1::date[])
         AND nav_type = 'pre_fee' AND unit_nav IS NOT NULL AND unit_nav > 0
       GROUP BY 1
       HAVING COUNT(DISTINCT nav_date) >= $2`,
      [picked, minHits],
    ).catch(() => [] as { code: string }[]),
  ])
  const extraCodes = [...emailCodes, ...teamCodes].map((r) => r.code)
  const aliased = extraCodes.length ? await fetchFundsForNavCodes(extraCodes) : []
  const weekly = await fetchPoolWeeklySharedDates(picked, exclude, minHits, 200)
  return mergeFundPools(official, aliased, weekly)
}

/** Weekly-density funds in the upload window (about one print per week). */
async function fetchPoolWeeklySharedDates(
  dates: string[],
  excludeBeian: string,
  _minHits: number,
  limit = 400,
): Promise<FundInfo[]> {
  if (dates.length < 3) return []
  const sorted = [...dates].sort()
  return fetchPoolWeeklyInWindow(sorted[0], sorted[sorted.length - 1], excludeBeian, limit)
}

async function fetchPoolWeeklyInWindow(
  fromDate: string,
  toDate: string,
  excludeBeian: string,
  limit = 400,
  uploadReturn?: number,
): Promise<FundInfo[]> {
  const exclude = excludeBeian.trim()
  const days = (Date.parse(toDate) - Date.parse(fromDate)) / 86_400_000
  if (!Number.isFinite(days) || days < 60) return []
  const weeks = Math.max(8, Math.round(days / 7))
  const ret = uploadReturn != null && isFinite(uploadReturn) ? uploadReturn : 0
  return query<FundInfo>(
    `WITH nav_counts AS (
       SELECT UPPER(BTRIM(beian_hao)) AS beian_hao,
              COUNT(*)::int AS cnt,
              (ARRAY_AGG(nav ORDER BY price_date))[1]::float8 AS first_nav,
              (ARRAY_AGG(nav ORDER BY price_date DESC))[1]::float8 AS last_nav
       FROM private_fund_nav
       WHERE price_date BETWEEN $2::date AND $3::date
         AND nav IS NOT NULL AND nav > 0
       GROUP BY 1
       HAVING COUNT(*) BETWEEN 12 AND 90
     )
     SELECT ${FUND_INFO_SELECT_LITE}
     FROM private_fund_info i
     JOIN nav_counts nc ON UPPER(BTRIM(i.beian_hao)) = nc.beian_hao
     WHERE ($1::text = '' OR UPPER(BTRIM(i.beian_hao)) <> UPPER(BTRIM($1)))
       AND nc.first_nav > 0
     ORDER BY ABS(nc.cnt - $5::int) ASC,
              ABS(nc.last_nav / nc.first_nav - 1 - $6::float8) ASC
     LIMIT $4`,
    [exclude, fromDate, toDate, limit, weeks, ret],
  ).catch((err) => {
    rethrowIfDbDown(err, "weekly window pool failed")
    return [] as FundInfo[]
  })
}

/**
 * For pure-curve-upload mode: find all funds that have nav records in
 * [fromDate, toDate], ordered by how many records they have in that range.
 * This ensures funds with dense nav history (even if stale) beat recently
 * active funds with sparse overlap — exactly what curve-matching needs.
 */
async function fetchPoolByWindowReturn(
  fromDate: string,
  toDate: string,
  excludeBeian: string,
  uploadReturn: number,
  limit = 200,
): Promise<FundInfo[]> {
  if (!isFinite(uploadReturn) || Math.abs(uploadReturn) < 0.015) return []
  const pad = 0.03
  const lo = uploadReturn >= 0
    ? Math.min(uploadReturn * 0.45, uploadReturn - pad)
    : Math.min(uploadReturn * 1.7, uploadReturn - pad)
  const hi = uploadReturn >= 0
    ? Math.max(uploadReturn * 1.8, uploadReturn + pad)
    : Math.max(uploadReturn * 0.45, uploadReturn + pad)
  const minR = Math.min(lo, hi)
  const maxR = Math.max(lo, hi)
  const exclude = excludeBeian.trim()
  return query<FundInfo>(
    `WITH s AS (
       SELECT UPPER(BTRIM(beian_hao)) AS code, MIN(price_date) AS mn, MAX(price_date) AS mx
       FROM private_fund_nav
       WHERE price_date BETWEEN $2::date AND $3::date AND nav IS NOT NULL AND nav > 0
       GROUP BY 1
       HAVING COUNT(*) >= 4
     ),
     ends AS (
       SELECT s.code, f.nav::float8 AS v0, l.nav::float8 AS v1
       FROM s
       JOIN private_fund_nav f
         ON UPPER(BTRIM(f.beian_hao)) = s.code AND f.price_date = s.mn AND f.nav > 0
       JOIN private_fund_nav l
         ON UPPER(BTRIM(l.beian_hao)) = s.code AND l.price_date = s.mx AND l.nav > 0
     )
     SELECT ${FUND_INFO_SELECT_LITE}
     FROM private_fund_info i
     JOIN ends e ON UPPER(BTRIM(i.beian_hao)) = e.code
     WHERE e.v0 > 0
       AND (e.v1 / e.v0 - 1) BETWEEN $4 AND $5
       AND ($1::text = '' OR UPPER(BTRIM(i.beian_hao)) <> UPPER(BTRIM($1)))
     ORDER BY ABS((e.v1 / e.v0 - 1) - $6) ASC
     LIMIT $7`,
    [exclude, fromDate, toDate, minR, maxR, uploadReturn, limit],
  ).catch((err) => {
    rethrowIfDbDown(err, "window-return pool failed")
    return [] as FundInfo[]
  })
}

async function fetchPoolByNavDateRange(
  fromDate: string,
  toDate: string,
  excludeBeian: string,
  limit = 600,
  uploadedNavCount = 0,
  uploadDates: string[] = [],
  endpoint?: { firstDate: string; lastDate: string; firstNav: number; lastNav: number },
  uploadReturn?: number,
): Promise<FundInfo[]> {
  const exclude = excludeBeian.trim()

  const [groupRows, navRows, dateRows, alignedRows, spanRows, endpointRows, emailRows, teamRows, shareClassRows, weeklyRows] = await Promise.all([
    query<FundInfo>(
      `WITH nav_beians AS (
         SELECT DISTINCT UPPER(BTRIM(beian_hao)) AS beian_hao
         FROM private_fund_nav_group
         WHERE price_date BETWEEN $2::date AND $3::date
           AND nav IS NOT NULL AND nav > 0
           AND ($1::text = '' OR UPPER(BTRIM(beian_hao)) <> UPPER(BTRIM($1)))
       )
       SELECT ${FUND_INFO_SELECT_LITE}
       FROM private_fund_info i
       WHERE UPPER(BTRIM(i.beian_hao)) = ANY(SELECT beian_hao FROM nav_beians)
       ORDER BY i.latest_nav_date DESC NULLS LAST
       LIMIT $4`,
      [exclude, fromDate, toDate, Math.ceil(limit * 0.8)],
    ).catch(() => [] as FundInfo[]),

    fetchPoolFromNavTable(fromDate, toDate, exclude, Math.ceil(limit * 0.8), uploadedNavCount),
    fetchPoolBySharedDates(uploadDates, exclude, 200),
    fetchPoolByAlignedWindow(fromDate, toDate, exclude, uploadedNavCount, 200),
    fetchPoolByDateSpan(fromDate, toDate, exclude, 400),
    endpoint
      ? fetchPoolByEndpointLevels(endpoint.firstDate, endpoint.lastDate, endpoint.firstNav, endpoint.lastNav, exclude, 80)
      : Promise.resolve([] as FundInfo[]),
    fetchPoolFromEmailNav(fromDate, toDate, exclude, 150, uploadedNavCount),
    fetchPoolFromTeamNav(fromDate, toDate, exclude, 80, uploadedNavCount),
    (Date.parse(toDate) - Date.parse(fromDate)) / 86_400_000 <= 90
      ? fetchPoolShareClassInWindow(fromDate, toDate, uploadedNavCount)
      : Promise.resolve([] as FundInfo[]),
    fetchPoolWeeklyInWindow(fromDate, toDate, exclude, 400, uploadReturn),
  ])

  const merged = mergeFundPools(shareClassRows, endpointRows, emailRows, teamRows, alignedRows, spanRows, dateRows, navRows, groupRows, weeklyRows)
  let returnRows: FundInfo[] = []
  if (uploadReturn != null && isFinite(uploadReturn) && merged.length < 800) {
    returnRows = await Promise.race([
      fetchPoolByWindowReturn(fromDate, toDate, exclude, uploadReturn, 120),
      new Promise<FundInfo[]>((resolve) => setTimeout(() => resolve([]), 8_000)),
    ]).catch(() => [] as FundInfo[])
  }
  const out = returnRows.length ? mergeFundPools(merged, returnRows) : merged
  console.log(`[similar-fund] date-range pool: ${groupRows.length} nav_group + ${navRows.length} nav + ${dateRows.length} shared-dates + ${alignedRows.length} aligned + ${endpointRows.length} endpoints + ${emailRows.length} email + ${teamRows.length} team + ${shareClassRows.length} share-class + ${weeklyRows.length} weekly + ${returnRows.length} window-return → ${out.length} merged`)
  return out
}

/** BFL A/B/C products are often missing from private_fund_info joins. */
async function fetchPoolShareClassInWindow(
  fromDate: string,
  toDate: string,
  uploadedNavCount = 0,
): Promise<FundInfo[]> {
  const target = uploadedNavCount || 20
  const codes = await query<{ code: string }>(
    `SELECT code FROM (
       SELECT UPPER(BTRIM(product_code)) AS code, COUNT(*)::int AS cnt
       FROM ops_email_nav_records
       WHERE nav_date BETWEEN $1::date AND $2::date
         AND nav IS NOT NULL AND nav > 0
         AND product_code IS NOT NULL AND BTRIM(product_code) ~ '[ABC]$'
       GROUP BY 1
       UNION ALL
       SELECT UPPER(BTRIM(beian_hao)), COUNT(*)::int
       FROM ops_team_nav_manual
       WHERE nav_date BETWEEN $1::date AND $2::date
         AND unit_nav IS NOT NULL AND unit_nav > 0 AND nav_type = 'pre_fee'
         AND beian_hao ~ '[ABC]$'
       GROUP BY 1
     ) t
     WHERE code IS NOT NULL AND BTRIM(code) <> ''
     ORDER BY ABS(cnt - $3::int) ASC, cnt DESC
     LIMIT 80`,
    [fromDate, toDate, target],
  ).catch(() => [] as { code: string }[])
  if (codes.length === 0) return []
  const funds = await fetchFundsForNavCodes(codes.map((r) => r.code))
  console.log(`[similar-fund] share-class window codes ${codes.length} → funds ${funds.length}`)
  return funds
}

async function fetchRecentNavPool(
  excludeBeian: string,
  limit = 250,
  overlapFrom: string | undefined = undefined,
): Promise<FundInfo[]> {
  const exclude = excludeBeian.trim()
  const from = overlapFrom?.slice(0, 10) || null
  return query<FundInfo>(
    `SELECT ${FUND_INFO_SELECT_LITE}
     FROM private_fund_info i
     WHERE ($1::text = '' OR i.beian_hao <> $1)
       AND i.latest_nav_date IS NOT NULL
       AND ($3::date IS NULL OR i.latest_nav_date >= $3::date)
     ORDER BY i.latest_nav_date DESC NULLS LAST
     LIMIT $2`,
    [exclude, limit, from],
  ).catch((err) => {
    rethrowIfDbDown(err, "recent NAV pool failed")
    return [] as FundInfo[]
  })
}

async function fetchFundsByKeyword(keyword: string, excludeBeian: string, limit = 40): Promise<FundInfo[]> {
  const token = keyword.trim()
  if (token.length < 2) return []
  const exclude = excludeBeian.trim()
  const like = `%${token}%`
  const [pfiRows, type6Rows] = await Promise.all([
    query<FundInfo>(
      `SELECT ${FUND_INFO_SELECT_LITE}
       FROM private_fund_info i
       WHERE ($1::text = '' OR i.beian_hao <> $1)
         AND (i.product_name ILIKE $2 OR i.beian_hao ILIKE $2 OR COALESCE(i.manager, '') ILIKE $2)
       ORDER BY
         CASE WHEN i.product_name ILIKE $2 THEN 0 ELSE 1 END,
         i.latest_nav_date DESC NULLS LAST
       LIMIT $3`,
      [exclude, like, limit],
    ).catch((err) => {
      rethrowIfDbDown(err, `pfi keyword pool failed ${token}`)
      return [] as FundInfo[]
    }),
    query<FundInfo>(
      `SELECT
         t.register_number AS beian_hao,
         COALESCE(NULLIF(BTRIM(t.fund_short_name), ''), NULLIF(BTRIM(t.fund_name), ''), t.register_number) AS product_name,
         '' AS manager,
         COALESCE(NULLIF(BTRIM(t.company_strategy_one), ''), NULLIF(BTRIM(t.platform_strategy_one), '')) AS strategy_l1,
         COALESCE(NULLIF(BTRIM(t.company_strategy_two), ''), NULLIF(BTRIM(t.platform_strategy_two), '')) AS strategy_l2,
         COALESCE(NULLIF(BTRIM(t.company_strategy_three), ''), NULLIF(BTRIM(t.platform_strategy_three), '')) AS strategy_l3,
         NULL::text AS inception_date,
         NULL::text AS ret_1w, NULL::text AS ret_1m, NULL::text AS ret_3m, NULL::text AS ret_6m, NULL::text AS ret_1y,
         NULL::text AS sharpe_1y, NULL::text AS calmar_1y,
         NULL::text AS latest_nav, NULL::text AS latest_nav_date
       FROM (
         SELECT DISTINCT ON (UPPER(BTRIM(register_number)))
           register_number, fund_name, fund_short_name,
           company_strategy_one, company_strategy_two, company_strategy_three,
           platform_strategy_one, platform_strategy_two, platform_strategy_three
         FROM type6_ops_team_full
         WHERE register_number IS NOT NULL
           AND (
             fund_name ILIKE $2
             OR fund_short_name ILIKE $2
             OR register_number ILIKE $2
           )
         ORDER BY UPPER(BTRIM(register_number)), updated_at DESC NULLS LAST, id DESC
       ) t
       WHERE ($1::text = '' OR UPPER(BTRIM(t.register_number)) <> UPPER(BTRIM($1)))
       LIMIT $3`,
      [exclude, like, limit],
    ).catch((err) => {
      rethrowIfDbDown(err, `type6 keyword pool failed ${token}`)
      return [] as FundInfo[]
    }),
  ])
  return mergeFundPools(pfiRows, type6Rows.map((row) => emptyFundMetrics(row)))
}

async function fetchFundsByStrategy(
  l1: string | null,
  l2: string | null,
  excludeBeian: string,
  limit = 120,
): Promise<FundInfo[]> {
  if (!l1 && !l2) return []
  const exclude = excludeBeian.trim()
  const l1Alts = l1 === "期货策略" ? ["期货策略", "管理期货"] : l1 ? [l1] : [""]
  const nameCta = l1 === "期货策略" || l2 === "量化期货" || l2 === "主观期货"
  const [pfiRows, type6Rows] = await Promise.all([
    query<FundInfo>(
      `SELECT ${FUND_INFO_SELECT_LITE}
       FROM private_fund_info i
       WHERE ($1::text = '' OR i.beian_hao <> $1)
         AND (
           ($2::boolean AND i.product_name ILIKE '%CTA%')
           OR ($3::text IS NOT NULL AND NULLIF(BTRIM(i.strategy_l1), '') = ANY($4::text[]))
           OR ($5::text IS NOT NULL AND NULLIF(BTRIM(i.strategy_l2), '') = $5)
         )
       ORDER BY
         CASE WHEN i.product_name ILIKE '%CTA%' THEN 0 ELSE 1 END,
         i.latest_nav_date DESC NULLS LAST
       LIMIT $6`,
      [exclude, nameCta, l1, l1Alts, l2, limit],
    ).catch((err) => {
      rethrowIfDbDown(err, "pfi strategy pool failed")
      return [] as FundInfo[]
    }),
    query<FundInfo>(
      `SELECT
         t.register_number AS beian_hao,
         COALESCE(NULLIF(BTRIM(t.fund_short_name), ''), NULLIF(BTRIM(t.fund_name), ''), t.register_number) AS product_name,
         '' AS manager,
         COALESCE(NULLIF(BTRIM(t.company_strategy_one), ''), NULLIF(BTRIM(t.platform_strategy_one), '')) AS strategy_l1,
         COALESCE(NULLIF(BTRIM(t.company_strategy_two), ''), NULLIF(BTRIM(t.platform_strategy_two), '')) AS strategy_l2,
         COALESCE(NULLIF(BTRIM(t.company_strategy_three), ''), NULLIF(BTRIM(t.platform_strategy_three), '')) AS strategy_l3,
         NULL::text AS inception_date,
         NULL::text AS ret_1w, NULL::text AS ret_1m, NULL::text AS ret_3m, NULL::text AS ret_6m, NULL::text AS ret_1y,
         NULL::text AS sharpe_1y, NULL::text AS calmar_1y,
         NULL::text AS latest_nav, NULL::text AS latest_nav_date
       FROM (
         SELECT DISTINCT ON (UPPER(BTRIM(register_number)))
           register_number, fund_name, fund_short_name,
           company_strategy_one, company_strategy_two, company_strategy_three,
           platform_strategy_one, platform_strategy_two, platform_strategy_three
         FROM type6_ops_team_full
         WHERE register_number IS NOT NULL
           AND (
             ($2::boolean AND (fund_name ILIKE '%CTA%' OR fund_short_name ILIKE '%CTA%'))
             OR ($3::text IS NOT NULL AND (
               NULLIF(BTRIM(company_strategy_one), '') = ANY($4::text[])
               OR NULLIF(BTRIM(platform_strategy_one), '') = ANY($4::text[])
             ))
             OR ($5::text IS NOT NULL AND (
               NULLIF(BTRIM(company_strategy_two), '') = $5
               OR NULLIF(BTRIM(platform_strategy_two), '') = $5
             ))
           )
         ORDER BY UPPER(BTRIM(register_number)), updated_at DESC NULLS LAST, id DESC
       ) t
       WHERE ($1::text = '' OR UPPER(BTRIM(t.register_number)) <> UPPER(BTRIM($1)))
       LIMIT $6`,
      [exclude, nameCta, l1, l1Alts, l2, limit],
    ).catch((err) => {
      rethrowIfDbDown(err, "type6 strategy pool failed")
      return [] as FundInfo[]
    }),
  ])
  return mergeFundPools(pfiRows, type6Rows.map((row) => emptyFundMetrics(row)))
}

function isDistinctiveNoteToken(token: string): boolean {
  if (/^CTA$/i.test(token)) return false
  if (/期货|量化|主观|管理|策略|债券|固收|股票|套利|期权|宏观/.test(token)) return false
  return token.length >= 2
}

async function fetchNoteGuidedPool(
  note: string,
  excludeBeian: string,
  limit = 180,
): Promise<{ funds: FundInfo[]; priorityKeys: string[]; label: string }> {
  const hints = inferStrategyFromUserNote(note)
  const tokens = extractNoteSearchTokens(note)
  if (!hints.l1 && !hints.l2 && tokens.length === 0) {
    return { funds: [], priorityKeys: [], label: "" }
  }
  const tasks: Promise<FundInfo[]>[] = []
  if (hints.l1 || hints.l2) {
    tasks.push(fetchFundsByStrategy(hints.l1, hints.l2, excludeBeian, 140))
  }
  for (const token of tokens.slice(0, 4)) {
    tasks.push(fetchFundsByKeyword(token, excludeBeian, 40))
  }
  const pools = await Promise.all(tasks)
  const funds = mergeFundPools(...pools)
  const priorityKeys: string[] = []
  const distinctive = tokens.filter(isDistinctiveNoteToken)
  for (const fund of funds) {
    const name = `${fund.product_name} ${fund.beian_hao} ${fund.manager}`
    if (distinctive.some((token) => name.toUpperCase().includes(token.toUpperCase()))) {
      priorityKeys.push(fund.beian_hao.trim().toUpperCase())
    }
  }
  const hintBits = [...hints.hints, ...tokens].filter(Boolean)
  return {
    funds: funds.slice(0, limit),
    priorityKeys,
    label: `按材料说明检索：${hintBits.slice(0, 6).join("、")}`,
  }
}

/** Map an email/nav code (e.g. CY504A) onto official candidate beians (SCY504). */
/**
 * Drop an interior unit-NAV print that V-shapes against both neighbors.
 * Product-page merge already does this (then interpolates); raw email can keep
 * a body_table spike that wrecks 5-point Pearson (e.g. CY504A 2026-09-04 0.86).
 */
function dropVShapeOutliers(points: NavPoint[]): NavPoint[] {
  if (points.length < 3) return points
  const sorted = [...points].sort((a, b) => a.price_date.localeCompare(b.price_date))
  const vals = sorted.map((p) => parseFloat(p.nav))
  return sorted.filter((_, i) => {
    if (i === 0 || i === sorted.length - 1) return true
    const prev = vals[i - 1]
    const cur = vals[i]
    const next = vals[i + 1]
    if (!(prev > 0 && cur > 0 && next > 0)) return true
    const mid = (prev + next) / 2
    const vsNeighbors = Math.abs(cur - mid) / mid
    const neighborsClose = Math.abs(next - prev) / prev < 0.08
    return !(neighborsClose && vsNeighbors > 0.05)
  })
}

function officialCodesForAlias(alias: string, officials: string[]): string[] {
  const u = alias.trim().toUpperCase()
  if (!u) return []
  const list = officials.map((o) => o.trim().toUpperCase()).filter(Boolean)
  const exact = list.filter((o) => o === u)
  if (exact.length) return exact
  const letter = /[ABC]$/u.test(u) ? u.slice(-1) : ""
  const hits = list.filter((o) => shareClassProductCodesMatch(u, o))
  if (letter) {
    const sameLetter = hits.filter((o) => o.endsWith(letter))
    if (sameLetter.length) return sameLetter
  }
  return hits
}

function mergeFundPools(...pools: FundInfo[][]): FundInfo[] {
  const map = new Map<string, FundInfo>()
  for (const pool of pools) {
    for (const fund of pool) {
      const key = fund.beian_hao.trim().toUpperCase()
      if (!key || map.has(key)) continue
      map.set(key, fund)
    }
  }
  return [...map.values()]
}

async function fetchCandidatePool(target: FundInfo, limit = 80): Promise<FundInfo[]> {
  // Match resolved 团队分类, else 平台分类 — not the often-empty private_fund_info.strategy_l*.
  const resolved = sqlType6TableResolvedStrategy()
  const rows = await query<FundInfo>(
    `SELECT i.beian_hao, i.product_name, i.manager,
            same.strategy_l1, same.strategy_l2, same.strategy_l3,
            i.inception_date::text AS inception_date,
            i.ret_1w::text, i.ret_1m::text, i.ret_3m::text, i.ret_6m::text, i.ret_1y::text,
            COALESCE(i.sharpe_1y, cache.sharpe_1y)::text AS sharpe_1y,
            COALESCE(i.calmar_1y, cache.calmar_1y)::text AS calmar_1y,
            i.latest_nav::text, i.latest_nav_date::text AS latest_nav_date
     FROM private_fund_info i
     ${RISK_CACHE_JOIN}
     JOIN (
       SELECT register_number, strategy_l1, strategy_l2, strategy_l3
       FROM (
         SELECT DISTINCT ON (UPPER(BTRIM(register_number)))
           register_number,
           ${resolved.l1} AS strategy_l1,
           ${resolved.l2} AS strategy_l2,
           ${resolved.l3} AS strategy_l3
         FROM type6_ops_team_full
         ORDER BY UPPER(BTRIM(register_number)), updated_at DESC NULLS LAST, id DESC
       ) t
       WHERE ($2::text IS NOT NULL AND t.strategy_l1 = $2::text)
          OR ($3::text IS NOT NULL AND t.strategy_l2 = $3::text)
     ) same ON UPPER(BTRIM(same.register_number)) = UPPER(BTRIM(i.beian_hao))
     WHERE i.beian_hao <> $1::text
     ORDER BY
       CASE WHEN $3::text IS NOT NULL AND same.strategy_l2 = $3::text THEN 0 ELSE 1 END,
       i.latest_nav_date DESC NULLS LAST
     LIMIT $4`,
    [target.beian_hao, target.strategy_l1, target.strategy_l2, limit],
  )
  return rows
}

async function loadNavNameAliases(
  funds: Pick<FundInfo, "beian_hao" | "product_name">[],
): Promise<Map<string, { type6Name: string | null; shortName: string | null }>> {
  const out = new Map<string, { type6Name: string | null; shortName: string | null }>()
  const beianHaos = funds.map((f) => f.beian_hao).filter(Boolean)
  if (beianHaos.length === 0) return out
  const upper = beianHaos.map((b) => b.trim().toUpperCase())
  const [type6Rows, bflRows] = await Promise.all([
    query<{ register_number: string; fund_name: string | null }>(
      `SELECT DISTINCT ON (UPPER(BTRIM(register_number)))
         register_number,
         NULLIF(BTRIM(fund_name), '') AS fund_name
       FROM type6_ops_team_full
       WHERE UPPER(BTRIM(register_number)) = ANY($1::text[])
       ORDER BY UPPER(BTRIM(register_number)), updated_at DESC NULLS LAST, id DESC`,
      [upper],
    ).catch(() => [] as { register_number: string; fund_name: string | null }[]),
    query<{ beian_hao: string; product_name: string | null; short_name: string | null }>(
      `SELECT beian_hao,
              NULLIF(BTRIM(product_name), '') AS product_name,
              NULLIF(BTRIM(short_name), '') AS short_name
       FROM private_fund_info_bfl
       WHERE UPPER(BTRIM(beian_hao)) = ANY($1::text[])`,
      [upper],
    ).catch(() => [] as { beian_hao: string; product_name: string | null; short_name: string | null }[]),
  ])
  for (const row of type6Rows) {
    const key = row.register_number.trim().toUpperCase()
    const prev = out.get(key) ?? { type6Name: null, shortName: null }
    out.set(key, { ...prev, type6Name: row.fund_name })
  }
  for (const row of bflRows) {
    const key = row.beian_hao.trim().toUpperCase()
    const prev = out.get(key) ?? { type6Name: null, shortName: null }
    out.set(key, {
      type6Name: prev.type6Name ?? row.product_name,
      shortName: row.short_name ?? prev.shortName,
    })
  }
  return out
}

function batchHistoryToPoints(
  history: Array<{ nav: number; nav_date: string; return_nav?: number }>,
): NavPoint[] {
  return history
    .map((p) => ({
      price_date: p.nav_date.slice(0, 10),
      nav: String(p.nav),
      cumulative_nav: p.return_nav != null ? String(p.return_nav) : String(p.nav),
    }))
    .sort((a, b) => a.price_date.localeCompare(b.price_date))
}

// Same merge as the product detail page (type6 + group + email + team), batched.
// Platform-only beian lookups miss funds whose NAV is stored under a short name
// (e.g. 正合弘毅1号 / SAWV62 shows 73 rows on the detail page).
async function fetchNavBatch(
  funds: Pick<FundInfo, "beian_hao" | "product_name">[],
  months = 36,
): Promise<Record<string, NavPoint[]>> {
  if (funds.length === 0) return {}
  const asOf = new Date().toISOString().slice(0, 10)
  const aliases = await loadNavNameAliases(funds)
  const identities: ProductNavIdentity[] = funds.map((f) => {
    const alias = aliases.get(f.beian_hao.trim().toUpperCase())
    const type6Name = alias?.type6Name?.trim() || null
    const shortName = alias?.shortName?.trim() || null
    return {
      beian_hao: f.beian_hao,
      product_name: f.product_name,
      short_name: (type6Name && type6Name !== f.product_name ? type6Name : null) || shortName,
    }
  })

  const out: Record<string, NavPoint[]> = {}
  try {
    const resolver = await BatchNavResolver.create(identities, asOf)
    const since = addDays(asOf, Math.max(NAV_HISTORY_LOOKBACK_DAYS, months * 31))
    for (let i = 0; i < funds.length; i++) {
      const points = batchHistoryToPoints(
        resolver.mergedHistoryForRiskMetrics(identities[i], since),
      )
      if (points.length > 0) out[funds[i].beian_hao] = points
    }
  } catch (err) {
    console.warn("[similar-fund] BatchNavResolver failed, falling back to detail series", err)
  }

  const missing = funds.filter((f) => !(out[f.beian_hao]?.length))
  if (missing.length === 0) return out

  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - months)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  await Promise.all(
    missing.map(async (f) => {
      try {
        const names = await resolveFundNames(f.beian_hao, f.product_name)
        const series = await loadFundNavSeries(
          f.beian_hao,
          names.product_name,
          names.short_name ?? identities.find((id) => id.beian_hao === f.beian_hao)?.short_name ?? "",
          { from: cutoffStr, to: asOf },
        )
        if (series.length > 0) {
          out[f.beian_hao] = series.map((p) => ({
            price_date: p.price_date,
            nav: p.level,
            cumulative_nav: p.level,
          }))
        }
      } catch (err) {
        console.warn(`[similar-fund] detail NAV fallback failed for ${f.beian_hao}`, err)
      }
    }),
  )
  return out
}

async function fetchNavBatchChunked(
  funds: Pick<FundInfo, "beian_hao" | "product_name">[],
  months = 36,
): Promise<Record<string, NavPoint[]>> {
  const out: Record<string, NavPoint[]> = {}
  const chunkSize = 40
  for (let i = 0; i < funds.length; i += chunkSize) {
    const chunk = funds.slice(i, i + chunkSize)
    const part = await withTimeout(
      fetchNavBatch(chunk, months),
      25_000,
      {} as Record<string, NavPoint[]>,
      `fetchNavBatch:${i}-${i + chunk.length}`,
    )
    Object.assign(out, part)
  }
  return out
}

async function fetchNavWindow(
  funds: Array<Pick<FundInfo, "beian_hao" | "product_name">>,
  from: string,
  to: string,
): Promise<Record<string, NavPoint[]>> {
  const officialCodes = [...new Set(funds.map((f) => f.beian_hao.trim().toUpperCase()).filter(Boolean))]
  const nameMap = new Map(funds.map((f) => [f.beian_hao.trim().toUpperCase(), f.product_name.trim()]))
  const names = [...new Set([...nameMap.values()].filter(Boolean))]
  if ((officialCodes.length === 0 && names.length === 0) || !from || !to) return {}

  const TABLES = [
    "private_fund_nav_group",
    "private_fund_nav_group_type6",
    "private_fund_nav",
  ]
  const out: Record<string, NavPoint[]> = {}
  const byCode = new Map<string, Map<string, NavPoint>>()
  const byName = new Map<string, Map<string, NavPoint>>()
  const put = (map: Map<string, Map<string, NavPoint>>, key: string, point: NavPoint) => {
    const k = key.trim()
    if (!k) return
    const series = map.get(k) ?? new Map<string, NavPoint>()
    series.set(point.price_date, point)
    map.set(k, series)
  }
  const chunkSize = 100
  for (let i = 0; i < officialCodes.length; i += chunkSize) {
    const officialChunk = officialCodes.slice(i, i + chunkSize)
    const codeChunk = expandBeiansWithShareClassFamily(officialChunk)
    const nameChunk = names.slice(i, i + chunkSize)
    const unionParts = TABLES.map((tbl) =>
      `SELECT BTRIM(beian_hao) AS beian_hao, NULLIF(BTRIM(product_name),'') AS product_name,
              price_date::text AS price_date, nav::text AS nav, cumulative_nav::text AS cnav
       FROM ${tbl}
       WHERE price_date BETWEEN $2::date AND $3::date
         AND nav IS NOT NULL AND nav > 0
         AND (
           UPPER(BTRIM(beian_hao)) = ANY($1::text[])
           OR (ARRAY_LENGTH($4::text[], 1) > 0 AND product_name = ANY($4::text[]))
         )`).join(" UNION ALL ")
    const rows = await query<{ beian_hao: string | null; product_name: string | null; price_date: string; nav: string; cnav: string | null }>(
      `SELECT * FROM (${unionParts}) u ORDER BY beian_hao, price_date`,
      [codeChunk, from, to, nameChunk.length ? nameChunk : []],
    ).catch((err) => {
      rethrowIfDbDown(err, "nav window query failed")
      console.warn("[similar-fund] nav window query failed", err)
      return [] as { beian_hao: string | null; product_name: string | null; price_date: string; nav: string; cnav: string | null }[]
    })
    for (const row of rows) {
      const date = String(row.price_date ?? "").slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !row.nav) continue
      const point: NavPoint = { price_date: date, nav: row.nav, cumulative_nav: row.cnav || row.nav }
      if (row.beian_hao) {
        const mapped = officialCodesForAlias(row.beian_hao, officialCodes)
        for (const code of mapped.length ? mapped : [row.beian_hao.trim().toUpperCase()]) put(byCode, code, point)
      }
      if (row.product_name) put(byName, row.product_name.trim(), point)
    }
    const emailRows = await query<{ beian_hao: string | null; product_name: string | null; price_date: string; nav: string; cnav: string | null }>(
      `SELECT BTRIM(product_code) AS beian_hao, NULLIF(BTRIM(fund_name),'') AS product_name,
              nav_date::text AS price_date, nav::text AS nav,
              COALESCE(adjusted_nav, cumulative_nav, nav)::text AS cnav
       FROM ops_email_nav_records
       WHERE nav_date BETWEEN $2::date AND $3::date
         AND nav IS NOT NULL AND nav > 0
         AND (
           UPPER(BTRIM(product_code)) = ANY($1::text[])
           OR (ARRAY_LENGTH($4::text[], 1) > 0 AND fund_name = ANY($4::text[]))
         )`,
      [codeChunk, from, to, nameChunk.length ? nameChunk : []],
    ).catch((err) => {
      console.warn("[similar-fund] email nav window failed", err)
      return [] as { beian_hao: string | null; product_name: string | null; price_date: string; nav: string; cnav: string | null }[]
    })
    for (const row of emailRows) {
      const date = String(row.price_date ?? "").slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !row.nav) continue
      const point: NavPoint = { price_date: date, nav: row.nav, cumulative_nav: row.cnav || row.nav }
      if (row.beian_hao) {
        const mapped = officialCodesForAlias(row.beian_hao, officialCodes)
        for (const code of mapped.length ? mapped : [row.beian_hao.trim().toUpperCase()]) put(byCode, code, point)
      }
      if (row.product_name) put(byName, row.product_name.trim(), point)
    }
    const teamCodes = [...new Set(officialChunk.flatMap((c) => teamNavBeianLookupCodes(c)))]
    if (teamCodes.length) {
      const teamRows = await query<{ beian_hao: string | null; price_date: string; nav: string; cnav: string | null }>(
        `SELECT BTRIM(beian_hao) AS beian_hao,
                nav_date::text AS price_date, unit_nav::text AS nav,
                COALESCE(adjusted_nav, cumulative_nav, unit_nav)::text AS cnav
         FROM ops_team_nav_manual
         WHERE nav_date BETWEEN $2::date AND $3::date
           AND unit_nav IS NOT NULL AND unit_nav > 0
           AND nav_type = 'pre_fee'
           AND UPPER(BTRIM(beian_hao)) = ANY($1::text[])`,
        [teamCodes, from, to],
      ).catch((err) => {
        console.warn("[similar-fund] team nav window failed", err)
        return [] as { beian_hao: string | null; price_date: string; nav: string; cnav: string | null }[]
      })
      for (const row of teamRows) {
        const date = String(row.price_date ?? "").slice(0, 10)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !row.nav) continue
        const point: NavPoint = { price_date: date, nav: row.nav, cumulative_nav: row.cnav || row.nav }
        if (!row.beian_hao) continue
        const exact = officialCodesForAlias(row.beian_hao, officialChunk)
        const mapped = exact.length ? exact : officialCodesForAlias(row.beian_hao, officialCodes)
        for (const code of mapped.length ? mapped : [row.beian_hao.trim().toUpperCase()]) put(byCode, code, point)
      }
    }
  }
  for (const code of officialCodes) {
    const merged = new Map<string, NavPoint>()
    const pname = nameMap.get(code) ?? ""
    for (const p of byCode.get(code)?.values() ?? []) merged.set(p.price_date, p)
    if (pname) for (const p of byName.get(pname)?.values() ?? []) merged.set(p.price_date, p)
    if (merged.size > 0) {
      out[code] = dropVShapeOutliers(
        [...merged.values()].sort((a, b) => a.price_date.localeCompare(b.price_date)),
      )
    }
  }
  return out
}

function navMapGet(navMap: Record<string, NavPoint[]>, beian: string): NavPoint[] {
  return navMap[beian] ?? navMap[beian.trim().toUpperCase()] ?? []
}

// ── Similarity math ─────────────────────────────────────────────────────────────

function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  const n = xs.length
  if (n < 4) return null
  const meanX = xs.reduce((s, v) => s + v, 0) / n
  const meanY = ys.reduce((s, v) => s + v, 0) / n
  let num = 0, denX = 0, denY = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX, dy = ys[i] - meanY
    num += dx * dy; denX += dx * dx; denY += dy * dy
  }
  const denom = Math.sqrt(denX * denY)
  return denom === 0 ? null : num / denom
}

function navValue(point: NavPoint): number {
  return parseFloat(point.cumulative_nav ?? point.nav)
}

function returnsFromPairedValues(targetVals: number[], candidateVals: number[]): {
  targetReturns: number[]
  candidateReturns: number[]
} {
  const targetReturns: number[] = []
  const candidateReturns: number[] = []
  for (let i = 1; i < targetVals.length; i++) {
    const prevT = targetVals[i - 1]
    const currT = targetVals[i]
    const prevC = candidateVals[i - 1]
    const currC = candidateVals[i]
    if (prevT > 0 && prevC > 0 && isFinite(currT) && isFinite(currC)) {
      const retT = currT / prevT - 1
      const retC = currC / prevC - 1
      // Skip distribution events: a large single-period drop in one series not reflected
      // in the other (e.g. unit-nav drops 3%+ while cumulative nav stays flat).
      // This happens when the uploaded CSV has cumulative nav but DB stores unit nav.
      const DROP = 0.03  // 3% threshold
      const isDistributionEvent = (retC < -DROP && retT > -DROP / 2) ||
                                   (retT < -DROP && retC > -DROP / 2)
      if (isDistributionEvent) continue
      targetReturns.push(retT)
      candidateReturns.push(retC)
    }
  }
  return { targetReturns, candidateReturns }
}

function pairByExactDate(
  targetPoints: NavPoint[],
  candidatePoints: NavPoint[],
): { targetVals: number[]; candidateVals: number[]; months: string[] } {
  const tMap = new Map(targetPoints.map((p) => [p.price_date, navValue(p)]))
  const cMap = new Map(candidatePoints.map((p) => [p.price_date, navValue(p)]))
  const shared = [...tMap.keys()].filter((d) => cMap.has(d)).sort()
  return {
    targetVals: shared.map((d) => tMap.get(d)!),
    candidateVals: shared.map((d) => cMap.get(d)!),
    months: [...new Set(shared.map((d) => d.slice(0, 7)))],
  }
}

function nearestNavPoint(sorted: NavPoint[], tMs: number, maxGapMs: number): NavPoint | null {
  let best: NavPoint | null = null
  let bestGap = Infinity
  for (const point of sorted) {
    const gap = Math.abs(Date.parse(point.price_date) - tMs)
    if (gap < bestGap) {
      bestGap = gap
      best = point
    }
    if (Date.parse(point.price_date) - tMs > maxGapMs) break
  }
  return best && bestGap <= maxGapMs ? best : null
}

/**
 * Pair the sparser series onto the denser one. A 200-point chart vs weekly
 * NAV must not attach 5 chart days to the same Friday (that zeros returns).
 */
function pairByNearestDate(
  targetPoints: NavPoint[],
  candidatePoints: NavPoint[],
  maxGapDays = 10,
  valueFn: (p: NavPoint) => number = navValue,
): { targetVals: number[]; candidateVals: number[]; months: string[] } {
  const cSorted = [...candidatePoints].sort((a, b) => a.price_date.localeCompare(b.price_date))
  const tSorted = [...targetPoints].sort((a, b) => a.price_date.localeCompare(b.price_date))
  const maxGapMs = maxGapDays * 86_400_000
  const targetVals: number[] = []
  const candidateVals: number[] = []
  const months: string[] = []
  const iterateTarget = tSorted.length <= cSorted.length * 1.35
  const keys = iterateTarget ? tSorted : cSorted
  const search = iterateTarget ? cSorted : tSorted
  for (const key of keys) {
    const keyMs = Date.parse(key.price_date)
    if (!isFinite(keyMs)) continue
    const other = nearestNavPoint(search, keyMs, maxGapMs)
    if (!other) continue
    const tPoint = iterateTarget ? key : other
    const cPoint = iterateTarget ? other : key
    const tv = valueFn(tPoint)
    const cv = valueFn(cPoint)
    if (!isFinite(tv) || !isFinite(cv) || tv <= 0 || cv <= 0) continue
    targetVals.push(tv)
    candidateVals.push(cv)
    months.push(key.price_date.slice(0, 7))
  }
  return { targetVals, candidateVals, months: [...new Set(months)] }
}

/** navValue using only the unit nav field (ignores cumulative_nav). */
function navValueUnit(point: NavPoint): number {
  return parseFloat(point.nav)
}

function pairByExactDateUnit(
  targetPoints: NavPoint[],
  candidatePoints: NavPoint[],
): { targetVals: number[]; candidateVals: number[]; months: string[] } {
  const tMap = new Map(targetPoints.map((p) => [p.price_date, navValueUnit(p)]))
  const cMap = new Map(candidatePoints.map((p) => [p.price_date, navValueUnit(p)]))
  const shared = [...tMap.keys()].filter((d) => cMap.has(d)).sort()
  return {
    targetVals: shared.map((d) => tMap.get(d)!),
    candidateVals: shared.map((d) => cMap.get(d)!),
    months: [...new Set(shared.map((d) => d.slice(0, 7)))],
  }
}

function pairByNearestDateUnitNav(
  targetPoints: NavPoint[],
  candidatePoints: NavPoint[],
  maxGapDays = 10,
): { targetVals: number[]; candidateVals: number[]; months: string[] } {
  return pairByNearestDate(targetPoints, candidatePoints, maxGapDays, navValueUnit)
}

function pairByMonthEnd(
  targetPoints: NavPoint[],
  candidatePoints: NavPoint[],
): { targetVals: number[]; candidateVals: number[]; months: string[] } {
  const lastOfMonth = (points: NavPoint[]) => {
    const map = new Map<string, NavPoint>()
    for (const p of [...points].sort((a, b) => a.price_date.localeCompare(b.price_date))) {
      map.set(p.price_date.slice(0, 7), p)
    }
    return map
  }
  const tMap = lastOfMonth(targetPoints)
  const cMap = lastOfMonth(candidatePoints)
  const months = [...tMap.keys()].filter((m) => cMap.has(m)).sort()
  return {
    targetVals: months.map((m) => navValue(tMap.get(m)!)),
    candidateVals: months.map((m) => navValue(cMap.get(m)!)),
    months,
  }
}

/** Median of a finite non-empty array. Returns 0 if empty. */
function median(arr: number[]): number {
  if (arr.length === 0) return 0
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

function extractAlignedReturns(
  targetPoints: NavPoint[],
  candidatePoints: NavPoint[],
): { targetReturns: number[]; candidateReturns: number[]; overlapMonths: number } {
  const empty = { targetReturns: [] as number[], candidateReturns: [] as number[], overlapMonths: 0 }
  if (targetPoints.length < 3 || candidatePoints.length < 3) return empty

  const exact = pairByExactDate(targetPoints, candidatePoints)
  const nearest = pairByNearestDate(targetPoints, candidatePoints, 10)
  const monthly = pairByMonthEnd(targetPoints, candidatePoints)
  const sparse = targetPoints.length < 36
  const picked = sparse && monthly.targetVals.length >= 4
    ? monthly
    : [exact, nearest, monthly].sort((a, b) => b.targetVals.length - a.targetVals.length)[0]
  if (picked.targetVals.length < 4) return empty

  // ── Scale-mismatch guard ──────────────────────────────────────────────────
  // The uploaded CSV may have cumulative_nav (e.g. 1.47) while the DB stores
  // unit_nav (e.g. 0.93).  When the medians differ by > 20 %, switch the
  // target side to use unit_nav, which should be on the same scale as DB.
  const tMed = median(picked.targetVals.filter(isFinite))
  const cMed = median(picked.candidateVals.filter(isFinite))
  const scaleRatio = tMed > 0 && cMed > 0 ? tMed / cMed : 1
  let finalPicked = picked
  if (scaleRatio > 1.20 || scaleRatio < 0.83) {
    // Retry with unit_nav on the uploaded (target) side
    const exactU = pairByNearestDateUnitNav(targetPoints, candidatePoints, 10)
    // Build unit-nav monthly manually
    const tSortedU = [...targetPoints].sort((a, b) => a.price_date.localeCompare(b.price_date))
    const cSortedU = [...candidatePoints].sort((a, b) => a.price_date.localeCompare(b.price_date))
    const tMonthEnd = new Map<string, NavPoint>()
    for (const p of tSortedU) tMonthEnd.set(p.price_date.slice(0, 7), p)
    const cMonthEnd = new Map<string, NavPoint>()
    for (const p of cSortedU) cMonthEnd.set(p.price_date.slice(0, 7), p)
    const uMonths = [...tMonthEnd.keys()].filter((m) => cMonthEnd.has(m))
    const monthlyUnitNav = {
      targetVals: uMonths.map((m) => navValueUnit(tMonthEnd.get(m)!)),
      candidateVals: uMonths.map((m) => navValue(cMonthEnd.get(m)!)),
      months: uMonths,
    }
    const unitPicked = [exactU, monthlyUnitNav].sort((a, b) => b.targetVals.length - a.targetVals.length)[0]
    if (unitPicked.targetVals.length >= finalPicked.targetVals.length) {
      finalPicked = unitPicked
    }
  }

  const { targetReturns, candidateReturns } = returnsFromPairedValues(finalPicked.targetVals, finalPicked.candidateVals)
  if (targetReturns.length < 3) return empty
  return { targetReturns, candidateReturns, overlapMonths: finalPicked.months.length }
}

// Compute a [0,1] metric similarity score from pre-computed indicators
function metricSimilarity(target: FundInfo, candidate: FundInfo): number {
  const fields: (keyof FundInfo)[] = ["ret_1m", "ret_3m", "ret_6m", "ret_1y", "sharpe_1y", "calmar_1y"]
  let sum = 0, count = 0
  for (const f of fields) {
    const tv = parseFloat(target[f] as string ?? "")
    const cv = parseFloat(candidate[f] as string ?? "")
    if (!isFinite(tv) || !isFinite(cv)) continue
    // Normalized difference: 1 - |tv-cv| / (|tv| + |cv| + ε)
    const diff = Math.abs(tv - cv)
    const mag = Math.abs(tv) + Math.abs(cv) + 1e-6
    sum += 1 - Math.min(diff / mag, 1)
    count++
  }
  return count > 0 ? sum / count : 0
}

function pairingReturnCorr(targetVals: number[], candidateVals: number[]): number | null {
  if (targetVals.length < 4) return null
  const { targetReturns, candidateReturns } = returnsFromPairedValues(targetVals, candidateVals)
  return pearsonCorrelation(targetReturns, candidateReturns)
}

function pairingReturnN(targetVals: number[]): number {
  return Math.max(0, targetVals.length - 1)
}

/** Ignore a 4-point Pearson of 1.00 when a 20-point pairing of 0.99 exists. */
function pickDenseCorr(entries: Array<{ corr: number | null; n: number }>): number | null {
  const ok = entries.filter((e): e is { corr: number; n: number } =>
    e.corr != null && Number.isFinite(e.corr) && e.n >= 3)
  if (!ok.length) return null
  const maxN = Math.max(...ok.map((e) => e.n))
  const minKeep = maxN >= 8 ? Math.max(6, Math.ceil(maxN * 0.4)) : 3
  const pool = ok.filter((e) => e.n >= minKeep)
  const use = pool.length ? pool : ok
  let best = use[0]
  let bestAdj = -Infinity
  for (const e of use) {
    const adj = e.corr * (0.5 + 0.5 * Math.min(1, e.n / Math.max(8, maxN)))
    if (adj > bestAdj + 1e-9) {
      bestAdj = adj
      best = e
    }
  }
  return best.corr
}

function bestPairingCorrelation(
  targetVals: number[],
  candidateVals: number[],
): number | null {
  if (targetVals.length < 4) return null
  const retC = pairingReturnCorr(targetVals, candidateVals)
  const lvlC = pearsonCorrelation(targetVals, candidateVals)
  const vals = [retC, lvlC].filter((v): v is number => v != null)
  return vals.length ? Math.max(...vals) : null
}

/** OCR/收益曲线 is usually 1.00→1.1x. Do not let level-Pearson ≈ 1 vs any rising 固收 beat a real return match. */
function seriesTotalReturn(points: NavPoint[]): number | null {
  const vals = points.map((p) => navValue(p)).filter((v) => v > 0)
  if (vals.length < 2 || !(vals[0] > 0)) return null
  return vals[vals.length - 1] / vals[0] - 1
}

function seriesUnitTotalReturn(points: NavPoint[]): number | null {
  const vals = points.map((p) => navValueUnit(p)).filter((v) => v > 0)
  if (vals.length < 2 || !(vals[0] > 0)) return null
  return vals[vals.length - 1] / vals[0] - 1
}

function isReturnIndexNav(points: NavPoint[]): boolean {
  const vals = points.map((p) => navValue(p)).filter((v) => v > 0)
  if (vals.length < 4) return false
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  if (!(lo > 0) || hi / lo >= 1.35) return false
  const mid = median(vals)
  return mid >= 0.75 && mid <= 1.45
}

function endpointLevelDist(targetPoints: NavPoint[], candidatePoints: NavPoint[]): number | null {
  if (targetPoints.length < 2 || candidatePoints.length < 2) return null
  const t0 = navValueUnit(targetPoints[0])
  const t1 = navValueUnit(targetPoints[targetPoints.length - 1])
  const c0 = navValueUnit(candidatePoints[0])
  const c1 = navValueUnit(candidatePoints[candidatePoints.length - 1])
  if (!(t0 > 0 && t1 > 0 && c0 > 0 && c1 > 0)) return null
  return Math.abs(c0 - t0) + Math.abs(c1 - t1)
}

function unitLevelResidual(targetPoints: NavPoint[], candidatePoints: NavPoint[]): number | null {
  const exact = pairByExactDateUnit(targetPoints, candidatePoints)
  if (exact.targetVals.length < 2) return null
  let sse = 0
  let n = 0
  for (let i = 0; i < exact.targetVals.length; i++) {
    const t = exact.targetVals[i]
    const c = exact.candidateVals[i]
    if (!isFinite(t) || !isFinite(c)) continue
    sse += (t - c) ** 2
    n++
  }
  return n ? sse / n : null
}

function computeSimilarity(
  target: FundInfo,
  targetNav: NavPoint[],
  candidate: FundInfo,
  candidateNav: NavPoint[],
): SimilarityResult {
  const aligned = extractAlignedReturns(targetNav, candidateNav)
  const exact = pairByExactDate(targetNav, candidateNav)
  const exactUnit = pairByExactDateUnit(targetNav, candidateNav)
  const unitNear = pairByNearestDateUnitNav(targetNav, candidateNav, 10)
  const monthly = pairByMonthEnd(targetNav, candidateNav)
  const returnIndex = isReturnIndexNav(targetNav)
  const correlation = pickDenseCorr(returnIndex
    ? [
      { corr: pearsonCorrelation(aligned.targetReturns, aligned.candidateReturns), n: aligned.targetReturns.length },
      { corr: pairingReturnCorr(exact.targetVals, exact.candidateVals), n: pairingReturnN(exact.targetVals) },
      { corr: pairingReturnCorr(exactUnit.targetVals, exactUnit.candidateVals), n: pairingReturnN(exactUnit.targetVals) },
      { corr: pairingReturnCorr(unitNear.targetVals, unitNear.candidateVals), n: pairingReturnN(unitNear.targetVals) },
      { corr: pairingReturnCorr(monthly.targetVals, monthly.candidateVals), n: pairingReturnN(monthly.targetVals) },
    ]
    : [
      { corr: pearsonCorrelation(aligned.targetReturns, aligned.candidateReturns), n: aligned.targetReturns.length },
      { corr: bestPairingCorrelation(exact.targetVals, exact.candidateVals), n: exact.targetVals.length },
      { corr: bestPairingCorrelation(exactUnit.targetVals, exactUnit.candidateVals), n: exactUnit.targetVals.length },
      { corr: bestPairingCorrelation(unitNear.targetVals, unitNear.candidateVals), n: unitNear.targetVals.length },
      { corr: bestPairingCorrelation(monthly.targetVals, monthly.candidateVals), n: monthly.targetVals.length },
    ])
  const overlapMonths = aligned.overlapMonths || exact.months.length || unitNear.months.length
  const metricScore = metricSimilarity(target, candidate)
  const levelResidual = unitLevelResidual(targetNav, candidateNav)
  const curveOnly = target.beian_hao === "UPLOAD"

  let score: number
  if (correlation !== null && (overlapMonths >= 2 || aligned.targetReturns.length >= 3 || exact.targetVals.length >= 4)) {
    score = curveOnly
      ? 0.9 * Math.max(0, correlation) + 0.1 * metricScore
      : 0.65 * Math.max(0, correlation) + 0.35 * metricScore
  } else {
    score = curveOnly ? 0 : metricScore
  }

  return {
    fund: candidate,
    score,
    correlation,
    metricScore,
    overlapMonths,
    navPoints: candidateNav.length,
    levelResidual,
    alignedExact: exactUnit.targetVals.length,
    nav: candidateNav,
  }
}

/** Pearson on 4–5 nearest dates can hit ~1.00 by chance; require enough exact dates. */
function confidentCurveOverlap(uploadN: number, alignedExact: number): boolean {
  if (alignedExact < 4) return false
  if (uploadN < 8) return alignedExact >= 4
  return alignedExact >= Math.max(4, Math.min(8, Math.ceil(uploadN * 0.35)))
}

/**
 * True only when the upload is the same NAV print as #1 (product-page CSV
 * self-match). High Pearson on returns/shape is not identity — a foreign
 * chart can correlate 0.95+ with a similar strategy.
 */
function isUploadedCurveIdentity(upload: NavPoint[], match?: SimilarityResult): boolean {
  if (!match) return false
  if (match.correlation == null || match.correlation < 0.995) return false
  if (!confidentCurveOverlap(upload.length, match.alignedExact)) return false
  const residual = match.levelResidual
  if (residual == null || residual > 1e-5) return false
  const end = endpointLevelDist(upload, match.nav)
  if (end == null || end > 0.012) return false
  return true
}

// ── Nav stats ───────────────────────────────────────────────────────────────────

function computeNavStats(navPoints: NavPoint[]): {
  totalReturn: string | null
  annReturn: string | null
  maxDrawdown: string | null
  sharpe: string | null
  calmar: string | null
  recordCount: number
  dateRange: string
} {
  const empty = { totalReturn: null, annReturn: null, maxDrawdown: null, sharpe: null, calmar: null, recordCount: navPoints.length, dateRange: "" }
  if (navPoints.length < 2) return empty
  const rawVals = navPoints.map((p) => parseFloat(p.cumulative_nav ?? p.nav))
  const dates = navPoints.map((p) => p.price_date)
  const dateRange = `${dates[0]} ~ ${dates[dates.length - 1]}`

  // If the series looks implausible (e.g. vision OCR returned fractional returns instead of nav),
  // detect and auto-rescale: if median nav is in 0–0.5 range and some values ≤ 0, treat as return_pct / 100.
  const sortedVals = [...rawVals].filter(isFinite).sort((a, b) => a - b)
  const medianVal = sortedVals[Math.floor(sortedVals.length / 2)] ?? 1
  const needsRescale = medianVal < 0.5 && medianVal > 0 && sortedVals[sortedVals.length - 1] < 2
  const vals = rawVals.map((v) => needsRescale ? (isFinite(v) && v > 0 ? 1 + v : null) : v)
    .filter((v): v is number => v !== null && isFinite(v) && v > 0)

  if (vals.length < 2) return { ...empty, dateRange }
  const first = vals[0]
  const last = vals[vals.length - 1]
  if (!isFinite(first) || first <= 0 || !isFinite(last)) {
    return { ...empty, dateRange }
  }
  const days = (new Date(dates[dates.length - 1]).getTime() - new Date(dates[0]).getTime()) / 86_400_000
  // 累计/年化 = first→last of 复权/累计. Do not compound-skip weekly crash
  // bounces (that turned 久阳润泉 +863% into +1056%). Only ignore a print
  // when unit NAV resets and 复权 does not.
  let peak = -Infinity
  let maxDd = 0
  const periodRets: number[] = []
  for (let i = 0; i < vals.length; i++) {
    if (i > 0 && vals[i - 1] > 0) {
      const r = vals[i] / vals[i - 1] - 1
      if (!isUnitResetVsAdjusted(navPoints, i)) periodRets.push(r)
    }
    if (isUnitResetVsAdjusted(navPoints, i)) {
      peak = vals[i]
    }
    if (vals[i] > peak) peak = vals[i]
    const dd = peak > 0 ? (peak - vals[i]) / peak : 0
    if (dd > maxDd) maxDd = dd
  }
  const totalRet = (last / first - 1) * 100
  const annRet = days > 0 ? (Math.pow(last / first, 365 / days) - 1) * 100 : null
  // Reject implausible drawdowns caused by OCR noise (> 50% for upload is suspicious)
  const drawdownSuspicious = maxDd > 0.5 && navPoints.length < 100
  let sharpe: string | null = null
  if (!drawdownSuspicious && annRet !== null && periodRets.length > 1 && days > 0) {
    const recPerYear = periodRets.length / (days / 365)
    const mean = periodRets.reduce((s, r) => s + r, 0) / periodRets.length
    const variance = periodRets.reduce((s, r) => s + (r - mean) ** 2, 0) / periodRets.length
    const annVol = Math.sqrt(variance) * Math.sqrt(recPerYear)
    if (annVol > 0) sharpe = ((annRet / 100) / annVol).toFixed(2)
  }
  const calmar = annRet !== null && maxDd > 0 && !drawdownSuspicious ? ((annRet / 100) / maxDd).toFixed(2) : null
  return {
    totalReturn: totalRet.toFixed(2),
    annReturn: annRet?.toFixed(2) ?? null,
    maxDrawdown: (maxDd > 0 && !drawdownSuspicious) ? (maxDd * 100).toFixed(2) : null,
    sharpe,
    calmar,
    recordCount: navPoints.length,
    dateRange,
  }
}

function overlayRiskFromNav(fund: FundInfo, nav: NavPoint[]): FundInfo {
  const stats = computeNavStats(nav)
  // Always prefer nav-computed stats (full available history) over DB pre-stored
  // "sharpe_1y" / "calmar_1y" which may cover a different 12-month window and
  // produce misleading comparisons when the uploaded fund IS the matched fund.
  return {
    ...fund,
    sharpe_1y: stats.sharpe ?? fund.sharpe_1y,
    calmar_1y: stats.calmar ?? fund.calmar_1y,
  }
}

function clipNavToRange(nav: NavPoint[], from?: string, to?: string): NavPoint[] {
  if (!from && !to) return nav
  return nav.filter((p) => (!from || p.price_date >= from) && (!to || p.price_date <= to))
}

/** Unit-NAV distribution: unit drops hard while 复权/累计 does not. */
function isUnitResetVsAdjusted(points: NavPoint[], i: number): boolean {
  if (i < 1 || i >= points.length) return false
  const unitPrev = parseFloat(points[i - 1].nav)
  const unitCur = parseFloat(points[i].nav)
  const adjPrev = parseFloat(points[i - 1].cumulative_nav ?? points[i - 1].nav)
  const adjCur = parseFloat(points[i].cumulative_nav ?? points[i].nav)
  if (!(unitPrev > 0 && unitCur > 0 && adjPrev > 0 && adjCur > 0)) return false
  if (Math.abs(unitPrev - adjPrev) < 1e-6 && Math.abs(unitCur - adjCur) < 1e-6) return false
  return unitCur / unitPrev - 1 < -0.15 && adjCur / adjPrev - 1 > -0.05
}

function sharedNavWindow(a: NavPoint[], b: NavPoint[]): { from?: string; to?: string } {
  if (!a.length || !b.length) return {}
  const from = a[0].price_date > b[0].price_date ? a[0].price_date : b[0].price_date
  const to = a[a.length - 1].price_date < b[b.length - 1].price_date ? a[a.length - 1].price_date : b[b.length - 1].price_date
  if (!from || !to || from > to) return {}
  return { from, to }
}

function navSpanDays(nav: NavPoint[]): number {
  if (nav.length < 2) return 0
  return (Date.parse(nav[nav.length - 1].price_date) - Date.parse(nav[0].price_date)) / 86_400_000
}

function formatOverlapPeriods(nav: NavPoint[]): string {
  const span = navSpanDays(nav)
  const one = (days: number) => {
    if (span + 10 < days) return "区间不足"
    const ret = navReturnOverDays(nav, days)
    if (ret == null) return "N/A"
    const n = parseFloat(ret)
    return `${n >= 0 ? "+" : ""}${ret}%`
  }
  return `${one(30)} / ${one(90)} / ${one(180)} / ${one(365)}`
}

/**
 * Drop a stale NAV cluster separated by a one-print jump (VW787B team 1.55
 * then email 1.02). Gradual 1→9 growth is not a scale break — keep it.
 */
function dropScaleDiscontinuities(points: NavPoint[], upload: NavPoint[]): NavPoint[] {
  if (points.length < 4) return points
  const units = points.map((p) => navValueUnit(p)).filter((v) => v > 0)
  if (units.length >= 2) {
    const lo = Math.min(...units)
    const hi = Math.max(...units)
    if (lo > 0 && hi / lo < 1.4) return points
  }
  const sorted = [...points].sort((a, b) => a.price_date.localeCompare(b.price_date))
  const cuts = [0]
  for (let i = 1; i < sorted.length; i++) {
    const prev = navValueUnit(sorted[i - 1])
    const cur = navValueUnit(sorted[i])
    if (prev > 0 && cur > 0 && Math.abs(cur / prev - 1) > 0.18) cuts.push(i)
  }
  cuts.push(sorted.length)
  if (cuts.length <= 2) return sorted
  const clusters: NavPoint[][] = []
  for (let i = 0; i < cuts.length - 1; i++) {
    const part = sorted.slice(cuts[i], cuts[i + 1])
    if (part.length) clusters.push(part)
  }
  if (clusters.length <= 1) return sorted
  const uploadMid = median(upload.map((p) => navValueUnit(p)).filter((v) => v > 0))
  clusters.sort((a, b) => {
    const ma = median(a.map((p) => navValueUnit(p)).filter((v) => v > 0))
    const mb = median(b.map((p) => navValueUnit(p)).filter((v) => v > 0))
    const da = uploadMid > 0 && ma > 0 ? Math.abs(ma / uploadMid - 1) : 99
    const db = uploadMid > 0 && mb > 0 ? Math.abs(mb / uploadMid - 1) : 99
    if (Math.abs(da - db) > 0.05) return da - db
    return b.length - a.length
  })
  return clusters[0]
}

/** Product-page tables carry last unit NAV onto every trading day between prints. */
function densifyUnitNavToDates(points: NavPoint[], dates: string[]): NavPoint[] {
  if (points.length === 0 || dates.length === 0) return points
  const sorted = [...points].sort((a, b) => a.price_date.localeCompare(b.price_date))
  const out: NavPoint[] = []
  let i = 0
  let last: NavPoint | null = null
  for (const date of dates) {
    while (i < sorted.length && sorted[i].price_date <= date) {
      last = sorted[i]
      i++
    }
    if (!last) continue
    const unit = last.nav
    out.push({ price_date: date, nav: unit, cumulative_nav: unit })
  }
  return out
}

/** First→last of 复权/累计 on this window. Unit-only resets are ignored. */
function compoundReturnInWindow(nav: NavPoint[]): number | null {
  if (nav.length < 2) return null
  const kept: number[] = []
  for (let i = 0; i < nav.length; i++) {
    if (isUnitResetVsAdjusted(nav, i)) continue
    const v = parseFloat(nav[i].cumulative_nav ?? nav[i].nav)
    if (isFinite(v) && v > 0) kept.push(v)
  }
  if (kept.length < 2) return null
  const first = kept[0]
  const last = kept[kept.length - 1]
  if (first <= 0) return null
  return last / first - 1
}

function navReturnOverDays(nav: NavPoint[], days: number): string | null {
  if (nav.length < 2) return null
  const last = nav[nav.length - 1]
  const cutoff = new Date(`${last.price_date}T00:00:00`).getTime() - days * 86_400_000
  const window = nav.filter((p) => new Date(`${p.price_date}T00:00:00`).getTime() >= cutoff)
  const ret = compoundReturnInWindow(window.length >= 2 ? window : nav)
  if (ret === null || !isFinite(ret)) return null
  return (ret * 100).toFixed(2)
}

function overlayReturnsFromNav(fund: FundInfo, nav: NavPoint[]): FundInfo {
  if (nav.length < 2) return overlayRiskFromNav(fund, nav)
  const last = nav[nav.length - 1]
  return overlayRiskFromNav({
    ...fund,
    latest_nav: last.nav,
    latest_nav_date: last.price_date,
    ret_1w: navReturnOverDays(nav, 7) ?? fund.ret_1w,
    ret_1m: navReturnOverDays(nav, 30) ?? fund.ret_1m,
    ret_3m: navReturnOverDays(nav, 90) ?? fund.ret_3m,
    ret_6m: navReturnOverDays(nav, 180) ?? fund.ret_6m,
    ret_1y: navReturnOverDays(nav, 365) ?? fund.ret_1y,
  }, nav)
}

function syntheticTargetFromMaterials(
  subject: string,
  materials: SimilarFundMaterialProfile | null,
  nav: NavPoint[],
): FundInfo {
  const last = nav[nav.length - 1]
  const productName = looksLikeFundIdentity(materials?.productName)
    ? materials!.productName!
    : looksLikeFundIdentity(subject)
      ? subject
      : "上传材料产品"
  return {
    beian_hao: materials?.beianHao || "UPLOAD",
    product_name: productName,
    manager: materials?.manager || "",
    strategy_l1: materials?.strategyL1 ?? null,
    strategy_l2: materials?.strategyL2 ?? null,
    strategy_l3: materials?.strategyHints.join("、") || null,
    inception_date: nav[0]?.price_date ?? null,
    ret_1w: null,
    ret_1m: null,
    ret_3m: null,
    ret_6m: null,
    ret_1y: null,
    sharpe_1y: null,
    calmar_1y: null,
    latest_nav: last?.nav ?? null,
    latest_nav_date: last?.price_date ?? null,
  }
}

function formatMaterialsSection(materials: SimilarFundMaterialProfile | null, fileNote = ""): string {
  if ((!materials || materials.files.length === 0) && !fileNote.trim()) return ""
  const fileLines = (materials?.files ?? []).map((file) => {
    const kind = similarFundMaterialKindLabel(file.kind)
    return `- ${kind}「${file.fileName}」：${file.summary.split("\n")[0]}`
  })
  const noteLine = fileNote.trim() ? `用户材料说明（提示词）：${fileNote.trim()}` : "用户未填写材料说明"
  const contextBit = materials?.documentContext ? "\n\n" + materials.documentContext : ""
  return `=== 上传材料解析 ===
${noteLine}
共 ${materials?.files.length ?? 0} 份。识别产品：${materials?.productName || "未知"}  备案号：${materials?.beianHao || "未知"}  管理人：${materials?.manager || "未知"}
策略线索：${materials?.strategyHints.join("、") || "无（净值图本身不推断策略）"}  提取净值点：${materials?.navSeries.length ?? 0} 条
${fileLines.join("\n")}${contextBit}`
}

function parseStoredRatio(value: string | null | undefined): string | null {
  if (!value) return null
  const n = parseFloat(value)
  return isFinite(n) ? n.toFixed(2) : null
}

function formatNavRiskLine(stats: ReturnType<typeof computeNavStats>, fund: FundInfo): string {
  const dbSharpe = parseStoredRatio(fund.sharpe_1y)
  const dbCalmar = parseStoredRatio(fund.calmar_1y)
  // Prefer nav-computed stats (full available history, distribution-adjusted) over
  // DB pre-stored "sharpe_1y"/"calmar_1y" which cover a fixed 12-month window and
  // may produce misleading numbers for unit-NAV series with distribution resets.
  const sharpe = stats.sharpe ?? dbSharpe
  const calmar = stats.calmar ?? dbCalmar
  const mdd = stats.maxDrawdown
  const source = stats.sharpe || stats.calmar
    ? `重叠区间计算（${stats.dateRange || "对齐日期"}）`
    : dbSharpe || dbCalmar
      ? "数据库预计算（一年期，禁止用来对比上传曲线）"
      : mdd
        ? `重叠区间回撤（${stats.dateRange || "对齐日期"}）`
        : null

  if (sharpe || calmar || mdd) {
    return `风险收益指标 — 来源: ${source}
  夏普: ${sharpe ?? "N/A"}  卡玛: ${calmar ?? "N/A"}  最大回撤: ${mdd ? "-" + mdd + "%" : "N/A"}  累计: ${stats.totalReturn ? "+" + stats.totalReturn + "%" : "N/A"}  年化: ${stats.annReturn ? "+" + stats.annReturn + "%" : "N/A"}
  说明: 已给出夏普/卡玛时禁止写「缺夏普/卡玛」或「缺风险指标」。与目标对比时用本行数字，不要再用数据库一年期旧值。`
  }
  return `风险指标不足：数据库一年期夏普/卡玛为空，且净值仅 ${stats.recordCount} 条无法回退计算`
}

// ── SSE helpers ─────────────────────────────────────────────────────────────────

function encodeEvent(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
}

// ── Main handler ────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let subject = ""
  let kbPath = ""
  let namedFund = false
  let fileNote = ""
  let matchOnly = false
  let beianHao = ""
  let uploaded: Array<{ name: string; buffer: Buffer }> = []
  const contentType = req.headers.get("content-type") || ""
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData()
      subject = String(form.get("subject") ?? "").trim()
      kbPath = String(form.get("kbPath") ?? "").trim()
      namedFund = String(form.get("namedFund") ?? "") === "1"
      fileNote = String(form.get("fileNote") ?? "").trim()
      matchOnly = String(form.get("matchOnly") ?? "") === "1"
      beianHao = String(form.get("beianHao") ?? "").trim()
      for (const item of form.getAll("files")) {
        if (item instanceof File && item.size > 0) {
          uploaded.push({ name: item.name, buffer: Buffer.from(await item.arrayBuffer()) })
        }
      }
    } else {
      const body = await req.json() as { subject?: string; kbPath?: string; namedFund?: boolean; fileNote?: string; matchOnly?: boolean; beianHao?: string }
      subject = String(body.subject ?? "").trim()
      kbPath = String(body.kbPath ?? "").trim()
      namedFund = body.namedFund === true || uploaded.length === 0
      fileNote = String(body.fileNote ?? "").trim()
      matchOnly = body.matchOnly === true
      beianHao = String(body.beianHao ?? "").trim()
    }
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 })
  }

  if (uploaded.length > MAX_SIMILAR_FUND_MATERIAL_FILES) {
    return NextResponse.json({ error: `每次最多上传 ${MAX_SIMILAR_FUND_MATERIAL_FILES} 份材料` }, { status: 400 })
  }
  if (!subject && uploaded.length === 0) {
    return NextResponse.json({ error: "请提供分析对象或上传产品材料" }, { status: 400 })
  }

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: object) => {
        try { controller.enqueue(encodeEvent(data)) } catch { /* closed */ }
      }

      let materials: SimilarFundMaterialProfile | null = null
      if (uploaded.length > 0) {
        try {
          materials = await parseSimilarFundMaterials(uploaded)
          const chartLike = materials.files.some((f) => f.kind === "chart")
          if (chartLike && materials.navSeries.length >= 16 && materials.navSeries.length < 80) {
            materials = {
              ...materials,
              navSeries: extendChartPastLastAxisTick(downsampleInterpolatedChartNav(materials.navSeries)),
            }
          }
          console.log(
            "[similar-fund] upload nav",
            materials.navSeries.map((p) => `${p.price_date}:${Number(p.nav).toFixed(4)}`).join(" "),
          )
        } catch (err) {
          emit({ type: "plan_text", content: `材料解析出错：${(err as Error).message}` })
        }
      }
      if (materials && fileNote) {
        materials = applyUserNoteToMaterials(materials, fileNote)
      }
      if (!namedFund && isWeakMaterialIdentity(subject)) subject = ""
      if (!subject) {
        subject = looksLikeFundIdentity(materials?.productName)
          ? materials!.productName!
          : "上传材料产品"
      }

      // ── Planning ──────────────────────────────────────────────────────────────
      try {
        emit({ type: "phase", phase: "planning", message: "正在制定相似度分析方案..." })
        const planModel = getChatModel(false)
        const fileNoteHint = fileNote
          ? " 用户材料说明（提示词）：" + fileNote
          : " 用户未说明策略；净值图本身不得推断 CTA/期货。"
        const unnamedBit = namedFund ? "" : "，未指定库内产品名称，禁止把文件名当成基金名"
        const materialHint = materials
          ? `用户上传了 ${materials.files.length} 份材料（${materials.files.map((f) => similarFundMaterialKindLabel(f.kind)).join("、")}）${unnamedBit}，请把材料中的净值、持仓、路演口径纳入相似性判断。${fileNoteHint}`
          : ""
        const planResp = await withTimeout(
          planModel.invoke([
            new SystemMessage(
              `你是私募基金研究员。用户希望为"${subject}"找出策略和风险收益特征最相似的同类产品。${materialHint}\n请简述分析思路：包括如何筛选候选池、用哪些维度量化相似性（净值相关性、绩效指标、策略分类、材料风格等）、预期报告结构，控制在150字以内。`,
            ),
            new HumanMessage(`请为"${subject}"的相似基金匹配分析制定方案。`),
          ]).then((r) => ({ content: r.content })),
          18_000,
          { content: "（规划超时，直接进入数据阶段）" },
          "planning",
        )
        const planText = typeof planResp.content === "string" ? planResp.content : JSON.stringify(planResp.content)
        emit({ type: "plan_text", content: planText })
        emit({ type: "plan_done" })
      } catch (err) {
        emit({ type: "plan_text", content: `规划出错：${(err as Error).message}` })
        emit({ type: "plan_done" })
      }

      // ── Step 1: Find target fund / parse materials ────────────────────────────
      let target: FundInfo | null = null
      emit({ type: "step_start", step: 1, title: uploaded.length ? "解析上传材料并匹配目标基金" : "获取目标基金基本信息" })
      try {
        target = await withTimeout(resolveTargetFund(subject, materials, namedFund, beianHao), 10_000, null, "fetchTarget")
        if (!target && materials) {
          target = syntheticTargetFromMaterials(subject, materials, materials.navSeries)
        }
        if (target && fileNote) {
          const noteHints = inferStrategyFromUserNote(fileNote)
          if (noteHints.l1 || noteHints.l2) {
            target = {
              ...target,
              strategy_l1: noteHints.l1 ?? target.strategy_l1,
              strategy_l2: noteHints.l2 ?? target.strategy_l2,
              strategy_l3: noteHints.hints.join("、") || target.strategy_l3,
            }
          }
        }
        const materialBit = (() => {
          if (!materials) return ""
          const n = materials.navSeries.length
          const first = materials.navSeries[0]?.price_date?.slice(0, 10)
          const last = materials.navSeries[n - 1]?.price_date?.slice(0, 10)
          const ret = seriesTotalReturn(materials.navSeries)
          const retBit = ret != null && Number.isFinite(ret) ? `，${ret >= 0 ? "+" : ""}${(ret * 100).toFixed(1)}%` : ""
          const spanBit = first && last ? `（${first}~${last}${retBit}）` : ""
          return `；材料 ${materials.files.length} 份，提取净值 ${n} 点${spanBit}`
        })()
        const unidentified = target?.beian_hao === "UPLOAD"
        emit({
          type: "step_done", step: 1,
          summary: unidentified
            ? `未从材料中识别产品名称，将按上传净值/收益曲线匹配相似产品${materialBit}`
            : target
              ? `已定位：${target.product_name}（${target.beian_hao}），策略：${strategyLabel(target)}${materialBit}`
              : `未能定位目标产品"${subject}"${materialBit}`,
        })
      } catch (err) {
        emit({ type: "step_done", step: 1, summary: `搜索出错：${(err as Error).message}` })
      }

      // ── Step 2: Build candidate pool ─────────────────────────────────────────
      let candidates: FundInfo[] = []
      let priorityBeian = new Set<string>()
      emit({ type: "step_start", step: 2, title: "构建同类基金候选池" })
      try {
        const poolSeed = target ?? (materials
          ? syntheticTargetFromMaterials(subject, materials, materials.navSeries)
          : null)
        // Only exclude the fund itself when the user explicitly named it (namedFund=true).
        // When uploading materials without naming a fund, we want to find what the upload matches —
        // including the fund itself if the CSV/chart belongs to it.
        const exclude = (namedFund && target && target.beian_hao !== "UPLOAD") ? target.beian_hao : ""
        const pools: FundInfo[][] = []
        const labels: string[] = []
        try {
          await query("SELECT 1")
        } catch (err) {
          throw new Error(dbErrorMessage(err))
        }
        if (poolSeed && (poolSeed.strategy_l1 || poolSeed.strategy_l2) && poolSeed.beian_hao !== "UPLOAD") {
          pools.push(await withTimeout(fetchCandidatePool(poolSeed, 80), 10_000, [], "fetchCandidates"))
          labels.push(`策略：${strategyLabel(poolSeed)}`)
        }
        if (fileNote) {
          const notePool = await fetchNoteGuidedPool(fileNote, exclude, 180)
          if (notePool.funds.length) {
            pools.push(notePool.funds)
            labels.push(notePool.label)
          }
          for (const key of notePool.priorityKeys) priorityBeian.add(key)
        }
        const chartStart = materials?.navSeries[0]?.price_date?.slice(0, 10) || undefined
        const chartEnd = materials?.navSeries[materials.navSeries.length - 1]?.price_date?.slice(0, 10) || undefined
        const firstUnit = materials?.navSeries[0] ? navValueUnit(materials.navSeries[0]) : NaN
        const lastUnit = materials?.navSeries.length
          ? navValueUnit(materials.navSeries[materials.navSeries.length - 1])
          : NaN
        const endpoint = chartStart && chartEnd && firstUnit > 0 && lastUnit > 0
          ? { firstDate: chartStart, lastDate: chartEnd, firstNav: firstUnit, lastNav: lastUnit }
          : undefined
        const hasUploadNav = Boolean(materials && materials.navSeries.length >= 4 && chartStart && chartEnd)
        const uploadRet = hasUploadNav ? seriesTotalReturn(materials!.navSeries) : null
        if (hasUploadNav) {
          const uploadDates = materials!.navSeries.map((p) => p.price_date.slice(0, 10))
          const weeklyMinHits = Math.max(3, Math.ceil(Math.min(uploadDates.length, 12) * 0.8))
          const [rangePool, weeklyPool] = await Promise.all([
            withTimeout(
              fetchPoolByNavDateRange(chartStart!, chartEnd!, exclude, 600, materials?.navSeries.length ?? 0, uploadDates, endpoint, uploadRet ?? undefined),
              80_000,
              [] as FundInfo[],
              "fetchDateRangePool",
            ),
            withTimeout(
              fetchPoolWeeklySharedDates(uploadDates, exclude, weeklyMinHits, 400),
              25_000,
              [] as FundInfo[],
              "weeklySharedPool",
            ),
          ])
          pools.push(mergeFundPools(rangePool, weeklyPool))
          labels.push("按净值曲线日期范围检索有净值产品")
        } else if (pools.every((p) => p.length === 0)) {
          pools.push(await fetchRecentNavPool(exclude, 250, chartStart))
          labels.push("近期有净值产品")
        }
        const merged = mergeFundPools(...pools)
        const noteTokens = extractNoteSearchTokens(fileNote).map((t) => t.toUpperCase())
        for (const fund of merged) {
          const hay = `${fund.product_name} ${fund.beian_hao}`.toUpperCase()
          if (noteTokens.some((token) => hay.includes(token))) {
            priorityBeian.add(fund.beian_hao.trim().toUpperCase())
          }
        }
        const priority = merged.filter((f) => priorityBeian.has(f.beian_hao.trim().toUpperCase()))
        const rest = merged.filter((f) => !priorityBeian.has(f.beian_hao.trim().toUpperCase()))
        candidates = [...priority, ...rest]

        // When the target was identified from uploaded materials (not explicitly named by user),
        // always include the target fund itself as the first candidate.
        // fetchCandidatePool internally excludes it, so we must inject it manually.
        if (!namedFund && poolSeed && poolSeed.beian_hao !== "UPLOAD") {
          const selfKey = poolSeed.beian_hao.trim().toUpperCase()
          if (!candidates.some((c) => c.beian_hao.trim().toUpperCase() === selfKey)) {
            candidates = [poolSeed, ...candidates]
          }
          priorityBeian.add(selfKey)
        }
        emit({
          type: "step_done", step: 2,
          summary: candidates.length > 0
            ? `候选池 ${candidates.length} 只（${labels.filter(Boolean).join("；") || "未按策略筛选"}）`
            : "未找到候选基金",
        })
      } catch (err) {
        emit({ type: "step_done", step: 2, summary: `候选池构建出错：${dbErrorMessage(err)}` })
      }

      if (candidates.length === 0) {
        try {
          const exclude = (namedFund && target && target.beian_hao !== "UPLOAD") ? target.beian_hao : ""
          const fStart = materials?.navSeries[0]?.price_date?.slice(0, 10)
          const fEnd = materials?.navSeries[materials.navSeries.length - 1]?.price_date?.slice(0, 10)
          const isCurve = Boolean(materials?.navSeries.length && (!target || target.beian_hao === "UPLOAD"))
          const fFirst = materials?.navSeries[0] ? navValueUnit(materials.navSeries[0]) : NaN
          const fLast = materials?.navSeries.length ? navValueUnit(materials.navSeries[materials.navSeries.length - 1]) : NaN
          const fEndpoint = fStart && fEnd && fFirst > 0 && fLast > 0
            ? { firstDate: fStart, lastDate: fEnd, firstNav: fFirst, lastNav: fLast }
            : undefined
          candidates = isCurve && fStart && fEnd
            ? await fetchPoolByNavDateRange(fStart, fEnd, exclude, 600, materials?.navSeries.length ?? 0, materials?.navSeries.map((p) => p.price_date) ?? [], fEndpoint, seriesTotalReturn(materials?.navSeries ?? []) ?? undefined)
            : await fetchRecentNavPool(exclude, 250, fStart)
        } catch (err) {
          console.warn("[similar-fund] fallback pool failed", err)
        }
      }

      // ── Step 3: Fetch NAV + compute similarity ────────────────────────────────
      let topSimilar: SimilarityResult[] = []
      let targetNav: NavPoint[] = []
      emit({ type: "step_start", step: 3, title: "获取净值数据并计算相似度" })
      try {
        const uploadedNav = materials?.navSeries ?? []
        const dates = uploadedNav.map((p) => p.price_date).filter(Boolean).sort()
        const shiftDate = (iso: string, days: number) => {
          const dt = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
          dt.setUTCDate(dt.getUTCDate() + days)
          return dt.toISOString().slice(0, 10)
        }
        const windowFrom = dates[0]
          ? shiftDate(dates[0], -21)
          : shiftDate(new Date().toISOString().slice(0, 10), -400)
        const windowTo = dates[dates.length - 1]
          ? shiftDate(dates[dates.length - 1], 14)
          : new Date().toISOString().slice(0, 10)

        const dbFunds = target && target.beian_hao !== "UPLOAD" ? [target, ...candidates] : candidates
        const navMap = await fetchNavWindow(dbFunds, windowFrom, windowTo)
        const uploadFirst = dates[0]
        const uploadLast = dates[dates.length - 1]
        const pageNavFunds = candidates.filter((c) => {
          const code = c.beian_hao.trim().toUpperCase()
          const clipped = dropScaleDiscontinuities(
            clipNavToRange(navMapGet(navMap, c.beian_hao), uploadFirst, uploadLast),
            uploadedNav,
          )
          const unique = new Set(clipped.map((p) => p.price_date)).size
          const shareClass = /[ABC]$/u.test(code)
          const priority = priorityBeian.has(code)
          return unique < 8 && (shareClass || priority || unique >= 2)
        })
          .sort((a, b) => {
            const rank = (c: FundInfo) => {
              const code = c.beian_hao.trim().toUpperCase()
              return (/[ABC]$/u.test(code) ? 20 : 0) + (priorityBeian.has(code) ? 10 : 0)
            }
            return rank(b) - rank(a)
          })
          .slice(0, 8)
        if (pageNavFunds.length > 0) {
          await Promise.all(pageNavFunds.map(async (fund) => {
            const key = fund.beian_hao.trim().toUpperCase()
            const series = await withTimeout(
              loadFundNavSeries(fund.beian_hao, fund.product_name, "", {
                from: uploadFirst,
                to: uploadLast,
              }),
              12_000,
              [] as { price_date: string; level: string }[],
              `pageNav:${key}`,
            )
            if (series.length < 4) return
            navMap[key] = series.map((p) => ({
              price_date: p.price_date,
              nav: p.level,
              cumulative_nav: p.level,
            }))
          }))
        }
        const dbNav = target && target.beian_hao !== "UPLOAD" ? navMapGet(navMap, target.beian_hao) : []
        targetNav = uploadedNav.length >= 4 ? uploadedNav : (dbNav.length ? dbNav : uploadedNav)
        if (target && targetNav.length >= 2) {
          target = overlayReturnsFromNav(target, targetNav)
        } else if (target) {
          target = overlayRiskFromNav(target, targetNav)
        }
        const scoredTarget = target
        const curveOnly = Boolean(target?.beian_hao === "UPLOAD")
        // When target was identified from materials (fingerprint / filename), inject a synthetic
        // perfect self-match so it always appears in results regardless of DB nav availability.
        const selfMatchBeian = (!namedFund && target && target.beian_hao !== "UPLOAD")
          ? target.beian_hao.trim().toUpperCase()
          : null

        const scored: SimilarityResult[] = []
        let withNav = 0
        const targetFrom = targetNav[0]?.price_date
        const targetTo = targetNav[targetNav.length - 1]?.price_date
        for (const c of candidates) {
          const cNav = dropVShapeOutliers(navMapGet(navMap, c.beian_hao))
          if (cNav.length < 2) continue
          const clipped = dropScaleDiscontinuities(clipNavToRange(cNav, targetFrom, targetTo), targetNav)
          const uploadDates = targetNav.map((p) => p.price_date)
          let statsNav = clipped.length >= 4 ? clipped : clipNavToRange(cNav, targetFrom, targetTo)
          if (statsNav.length < 4) continue
          if (targetNav.length >= 8 && statsNav.length >= 2 && statsNav.length < 8) {
            const filled = densifyUnitNavToDates(statsNav, uploadDates)
            if (filled.length >= 4) statsNav = filled
          }
          if (statsNav.length < 4) continue
          withNav++
          const candidateWithRisk = overlayReturnsFromNav(c, statsNav)
          const result = computeSimilarity(scoredTarget ?? candidateWithRisk, targetNav, candidateWithRisk, statsNav)
          scored.push({ ...result, fund: candidateWithRisk, nav: statsNav })
        }

        const uploadMonths = new Set(targetNav.map((p) => p.price_date.slice(0, 7))).size
        const minOverlap = curveOnly && uploadMonths >= 6
          ? Math.max(4, Math.ceil(uploadMonths * 0.5))
          : 2
        const uploadRet = seriesTotalReturn(targetNav)
        const returnIndexUpload = isReturnIndexNav(targetNav)
        type Scored = SimilarityResult & { fund: FundInfo; nav: NavPoint[]; candRet: number | null; adj: number }
        const coverAdj = (r: { correlation: number | null; overlapMonths: number; nav: NavPoint[]; candRet?: number | null }) => {
          const cov = r.overlapMonths / Math.max(uploadMonths, 1)
          const base = (r.correlation ?? -1) * (0.35 + 0.65 * Math.min(1, cov))
          if (!returnIndexUpload || uploadRet == null || !isFinite(uploadRet)) return base
          const cand = r.candRet ?? seriesUnitTotalReturn(r.nav)
          if (cand == null || !isFinite(cand)) return base * 0.92
          return base / (1 + Math.abs(cand - uploadRet) * 2)
        }
        const ranked: Scored[] = scored.map((r) => {
          const candRet = seriesUnitTotalReturn(r.nav) ?? seriesTotalReturn(r.nav)
          return { ...r, candRet, adj: coverAdj({ ...r, candRet }) }
        })
        topSimilar = ranked
          .filter((r) => {
            if (curveOnly) {
              return r.correlation !== null && r.correlation > 0.25 && r.navPoints >= 4 && r.overlapMonths >= minOverlap
            }
            return r.score > 0
          })
          .sort((a, b) => {
            const adjDiff = a.adj - b.adj
            // A 3-month 0.99 must not beat a 9-month 0.85 path match (chart OCR).
            if (Math.abs(adjDiff) > 0.002) return b.adj - a.adj
            const ca = a.correlation ?? -1
            const cb = b.correlation ?? -1
            const corrDiff = cb - ca
            if (Math.abs(corrDiff) > 0.002) return corrDiff
            const uploadN = targetNav.length
            const confA = confidentCurveOverlap(uploadN, a.alignedExact)
            const confB = confidentCurveOverlap(uploadN, b.alignedExact)
            if (confA !== confB) return confA ? -1 : 1
            if (a.alignedExact !== b.alignedExact) return b.alignedExact - a.alignedExact
            const countDiff = Math.abs(a.navPoints - uploadN) - Math.abs(b.navPoints - uploadN)
            if (countDiff !== 0) return countDiff
            const endA = endpointLevelDist(targetNav, a.nav)
            const endB = endpointLevelDist(targetNav, b.nav)
            if (endA != null && endB != null && Math.abs(endA - endB) > 1e-8) return endA - endB
            const ra = a.levelResidual ?? Number.POSITIVE_INFINITY
            const rb = b.levelResidual ?? Number.POSITIVE_INFINITY
            if (Math.abs(ra - rb) > 1e-12) return ra - rb
            return b.score - a.score
          })
          .slice(0, 6)

        // Copy upload stats onto #1 only when unit-NAV levels match (same print).
        // Shape correlation alone is "most similar", not "this is the fund".
        if (scoredTarget && topSimilar[0] && isUploadedCurveIdentity(targetNav, topSimilar[0])) {
          const top = topSimilar[0]
          topSimilar[0] = {
            ...top,
            fund: {
              ...top.fund,
              ret_1w: scoredTarget.ret_1w,
              ret_1m: scoredTarget.ret_1m,
              ret_3m: scoredTarget.ret_3m,
              ret_6m: scoredTarget.ret_6m,
              ret_1y: scoredTarget.ret_1y,
              sharpe_1y: scoredTarget.sharpe_1y,
              calmar_1y: scoredTarget.calmar_1y,
            },
            nav: targetNav.length >= 4 ? targetNav : top.nav,
          }
        }

        const navCount = Object.values(navMap).reduce((s, v) => s + v.length, 0) + uploadedNav.length
        const topHint = topSimilar
          .slice(0, 3)
          .map((r) => r.fund.product_name + " " + (r.correlation != null ? r.correlation.toFixed(2) : "N/A"))
          .join("、")
        const uploadBit = uploadedNav.length ? "（含上传 " + uploadedNav.length + " 点）" : ""
        const corrBit = topHint ? "。最高相关：" + topHint : ""
        emit({
          type: "step_done", step: 3,
          summary: `获取了 ${navCount} 条净值记录${uploadBit}；${candidates.length} 只候选中 ${withNav} 只有重叠净值，筛出 ${topSimilar.length} 只相似基金${corrBit}`,
        })
        emit({
          type: "matches",
          items: topSimilar.map((r, idx) => ({
            rank: idx + 1,
            beian_hao: r.fund.beian_hao,
            product_name: r.fund.product_name,
            correlation: r.correlation,
            score: r.score,
            overlapMonths: r.overlapMonths,
            navPoints: r.navPoints,
            sameProduct: idx === 0 && isUploadedCurveIdentity(targetNav, r),
          })),
        })
      } catch (err) {
        emit({ type: "step_done", step: 3, summary: `相似度计算出错：${(err as Error).message}` })
      }

      if (matchOnly) {
        emit({ type: "step_done", step: 4, summary: "已跳过知识库（仅匹配）" })
        emit({ type: "step_done", step: 5, summary: "已跳过报告（仅匹配）" })
        emit({ type: "done" })
        try { controller.close() } catch { /* already closed */ }
        return
      }

      // ── Step 4: Knowledge base ────────────────────────────────────────────────
      let kbContext = ""
      emit({ type: "step_start", step: 4, title: "查询知识库补充信息" })
      try {
        const { askKnowledgeBaseQuestion } = await import("@/lib/server/knowledge-chat")
        const querySubjects = [
          namedFund && !isWeakMaterialIdentity(subject) ? subject : null,
          looksLikeFundIdentity(materials?.productName) ? materials?.productName : null,
          ...topSimilar.slice(0, 3).map((r) => r.fund.product_name),
        ].filter((s, i, arr): s is string => Boolean(s && s.trim()) && arr.indexOf(s) === i)
        const kbResults = await Promise.allSettled(
          querySubjects.map((s) =>
            withTimeout(
              askKnowledgeBaseQuestion({
                question: `关于"${s}"：请提取策略特点、历史业绩、风险控制方法和团队背景。`,
                folderPath: kbPath || null,
                useBm25: true,
                modelMode: "turbo",
                deepSearch: false,
              }),
              20_000,
              { answer: "", sources: [] as string[], indexedDocuments: 0, indexedChunks: 0, model: "", tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
              `kb:${s}`,
            ),
          ),
        )
        const sections: string[] = []
        for (let i = 0; i < querySubjects.length; i++) {
          const r = kbResults[i]
          if (r.status === "fulfilled" && r.value.answer.trim().length > 30) {
            sections.push(`【${querySubjects[i]}】\n${r.value.answer.trim()}`)
          }
        }
        kbContext = sections.join("\n\n---\n\n")
        emit({
          type: "step_done", step: 4,
          summary: kbContext.length > 50 ? `知识库检索完成，覆盖 ${sections.length} 个研究对象` : "知识库中未找到相关内容",
        })
      } catch (err) {
        emit({ type: "step_done", step: 4, summary: `知识库查询出错：${(err as Error).message}` })
      }

      // ── Step 5: Generate report ───────────────────────────────────────────────
      emit({ type: "step_start", step: 5, title: "生成相似度分析报告" })
      try {
        if (topSimilar.length === 0) {
          const title = target && target.beian_hao !== "UPLOAD"
            ? `${target.product_name}（${target.beian_hao}）`
            : (subject && !isWeakMaterialIdentity(subject) ? subject : "上传净值曲线产品")
          const text = `# 相似基金分析报告：${title}\n\n## 执行摘要\n\n未能在库内匹配到有效相关的基金（重叠净值不足或相似度未筛出候选）。没有可引用的白名单产品，故不生成排名表，以免编造基金或备案号。\n`
          emit({ type: "report_text", delta: text })
          emit({ type: "step_done", step: 5, summary: "未能匹配到相似基金" })
          emit({ type: "done" })
          try { controller.close() } catch { /* already closed */ }
          return
        }
        // Build data summary — both sides on the same overlapping dates.
        const unnamedUpload = target?.beian_hao === "UPLOAD"
        const navSource = materials && materials.navSeries.length >= 5 && targetNav === materials.navSeries
          ? "上传材料提取"
          : unnamedUpload
            ? "上传材料提取"
            : "数据库合并净值"
        const targetStats = computeNavStats(targetNav)
        const targetSection = unnamedUpload
          ? `=== 目标画像（上传材料，库内产品名称未知） ===
【上传材料产品】用户只提供了净值/收益曲线等材料，图中没有产品名。禁止把文件名或任何库内基金当作目标产品。
  净值来源: ${navSource}（${targetNav.length} 点，${targetStats.dateRange || "日期未知"}）
  ${formatNavRiskLine(targetStats, target!)}
  近1月/3月/6月/1年（上传曲线自身窗口）: ${formatOverlapPeriods(targetNav)}`
          : target
          ? `=== 目标基金 ===
【${target.product_name}】(${target.beian_hao})
  管理人: ${target.manager}  成立: ${target.inception_date ?? "未知"}
  策略: ${strategyLabel(target)}
  最新净值: ${target.latest_nav ?? "N/A"} (${target.latest_nav_date ?? "N/A"})
  近1月/3月/6月/1年（目标净值窗口）: ${formatOverlapPeriods(targetNav)}
  净值来源: ${navSource}（${targetNav.length} 点）
  ${formatNavRiskLine(targetStats, target)}`
          : `=== 目标基金 ===\n注：数据库中未找到"${subject}"的精确记录，分析主要依据上传材料`

        const similarSection = topSimilar.map((r, idx) => {
          const win = sharedNavWindow(targetNav, r.nav)
          const uploadOverlap = clipNavToRange(targetNav, win.from, win.to)
          const candOverlap = clipNavToRange(r.nav, win.from, win.to)
          const uploadStats = computeNavStats(uploadOverlap.length >= 2 ? uploadOverlap : targetNav)
          const stats = computeNavStats(candOverlap.length >= 2 ? candOverlap : r.nav)
          const corrStr = r.correlation !== null ? r.correlation.toFixed(3) : "N/A（数据不足）"
          const metricStr = r.metricScore !== null ? (r.metricScore * 100).toFixed(1) + "%" : "N/A"
          const sameProduct = idx === 0 && isUploadedCurveIdentity(targetNav, r)
          const windowLabel = uploadStats.dateRange || stats.dateRange || "未知"
          return `=== #${idx + 1} 最相似基金（综合评分: ${(r.score * 100).toFixed(1)}）===
【${r.fund.product_name}】(${r.fund.beian_hao})
  管理人: ${r.fund.manager}  成立: ${r.fund.inception_date ?? "未知"}
  策略: ${strategyLabel(r.fund)}
  相关性（重叠${r.overlapMonths}个月）: ${corrStr}
  指标相似度: ${metricStr}
  ${sameProduct ? "判定: 上传曲线即该基金本身（单位净值水平与日期对齐均吻合）。区间收益/夏普/卡玛已与目标对齐，必须写成同一产品。" : "判定: 曲线相似，但不是同一产品。只写「最相似/候选」，禁止写「即该基金本身」「同一产品」。"}
  净值记录数: ${r.navPoints}条${r.navPoints === 0 ? "（本次合并未取到序列，不得写成产品未披露净值）" : ""}
【重叠区间对比 — 只允许用下面这组数字对比收益/回撤/夏普/卡玛/近1月~1年。禁止用成立以来或库内近一年。】
  重叠日期: ${windowLabel}
  上传曲线同一区间: 累计 ${uploadStats.totalReturn != null ? "+" + uploadStats.totalReturn + "%" : "N/A"}  年化 ${uploadStats.annReturn != null ? "+" + uploadStats.annReturn + "%" : "N/A"}  回撤 ${uploadStats.maxDrawdown != null ? "-" + uploadStats.maxDrawdown + "%" : "N/A"}  夏普 ${uploadStats.sharpe ?? "N/A"}  卡玛 ${uploadStats.calmar ?? "N/A"}
  近1月/3月/6月/1年（上传）: ${formatOverlapPeriods(uploadOverlap.length >= 2 ? uploadOverlap : targetNav)}
  本基金同一区间: 累计 ${stats.totalReturn != null ? "+" + stats.totalReturn + "%" : "N/A"}  年化 ${stats.annReturn != null ? "+" + stats.annReturn + "%" : "N/A"}  回撤 ${stats.maxDrawdown != null ? "-" + stats.maxDrawdown + "%" : "N/A"}  夏普 ${stats.sharpe ?? "N/A"}  卡玛 ${stats.calmar ?? "N/A"}
  近1月/3月/6月/1年（本基金重叠区间）: ${formatOverlapPeriods(candOverlap.length >= 2 ? candOverlap : r.nav)}
  ${formatNavRiskLine(stats, r.fund)}`
        }).join("\n\n")

        const kbSection = kbContext ? `\n=== 知识库补充信息 ===\n${kbContext}` : ""
        const materialsSection = formatMaterialsSection(materials, fileNote)

        const reportSubject = unnamedUpload ? "上传净值/材料所代表的未知产品" : subject
        const allowedList = topSimilar.length
          ? topSimilar.map((r, idx) => {
            const corr = r.correlation != null ? r.correlation.toFixed(3) : "N/A"
            return (idx + 1) + ". " + r.fund.product_name + "（" + r.fund.beian_hao + "）相关性 " + corr
          }).join("\n")
          : "（无）本次没有算出任何有效相关的库内基金。报告必须写「未能匹配」，禁止点名任何产品。"
        const materialsBlock = materialsSection ? "\n" + materialsSection : ""
        const userPrompt = `请基于以下数据，为"${reportSubject}"生成相似基金分析报告：

${targetSection}

${similarSection || "（没有可写入的相似基金。不要编造。）"}
${materialsBlock}
${kbSection}

【白名单 — 报告中允许出现的产品仅限下列，备案号必须原样抄写】
${allowedList}

报告要求：
1. 只分析白名单中的基金。禁止新增任何产品名或备案号。
2. 相关性、备案号、净值点数必须抄上面的数字，禁止改写成 0.94 或 SCT123456 这类不存在的值。
3. 明确指出综合最相似的基金（若白名单为空则说明无法匹配）
4. 默认任务是找最相似的库内基金，不是认定上传材料就是某只库内产品。只有条目写了「上传曲线即该基金本身」才按同一产品写；相关性高（哪怕 0.99）若判定为「相似但不是同一产品」，必须按两只不同产品写相似点与差异，禁止套用「即该基金本身」。
5. 若分析对象来自上传材料且没有产品名称：标题用「上传净值曲线产品」；执行摘要写明产品名称未知
6. 知识库内容只能补充白名单基金，不能引入名单外产品
7. 用户材料说明是提示词，只用于理解策略口径；禁止据此编造未出现在白名单中的产品
8. 对比累计/年化/回撤/夏普/卡玛/近1月~1年时，只使用各条目「重叠区间对比」里的数字。禁止用成立以来、产品页全历史、或库内近一年去对比上传曲线。
9. 两侧累计或年化相差不到 3 个百分点、夏普/卡玛相差不到 0.08 时，必须写「重叠区间内基本一致」，禁止写「落差巨大」「严重不匹配」「不可比」。`

        const systemPrompt = `你是专业私募基金研究员，擅长基金相似性分析和投资策略研究。
请生成"${reportSubject}"的相似基金分析报告，格式要求：
- Markdown格式，使用#/##/###标题层级
- 不要再输出标题或排名总览表（系统已给出）。从执行摘要写起。
- 执行摘要（最相似基金结论、1-2句核心发现）
- 逐一分析白名单中的相似基金（相似点、差异点）
- 最相似基金深度剖析
- 投资建议（配置价值、替代/互补关系）
- 语言专业严谨。没有数据就写「未能匹配」，绝对不要编造基金、备案号或相关系数。
- 备案号若像 SCT123456、S000000 这种占位符，说明你在编造，这是禁止的。
- 禁止把文件名（如「净值」）或未出现在白名单中的产品当成目标或相似基金。
风险收益可比性规则（必须遵守）：
- 使用各条目「重叠区间对比」中的夏普/卡玛/累计/年化/近1月~1年，禁止改用成立以来、产品页全历史、或你记得的一年期数据库数字。
- 相关性衡量的是重叠区间走势相近，不是身份。未标注「上传曲线即该基金本身」时，#1 只是最相似候选；差异只能写重叠区间里确实不同的数字，禁止拿候选基金成立以来收益对比上传曲线。
- 仅当输入标注「上传曲线即该基金本身」时，才写成同一产品，并沿用已对齐的区间收益/夏普/卡玛。
- 只要已给出夏普或卡玛，禁止写「缺夏普/卡玛」或「缺风险指标」。
- 净值记录数来自本次合并拉取。禁止把 0 条写成「尚未披露历史净值」。
- 「区间不足」表示该近N月窗口长于重叠区间，照抄「区间不足」，禁止用更长历史填数。`

        const uploadCurveLine = targetNav.length
          ? `识别曲线：${targetNav.map((p) => {
            const v = navValue(p)
            return `${p.price_date} ${Number.isFinite(v) ? ((v - 1) * 100).toFixed(1) + "%" : "?"}`
          }).join(" · ")}`
          : ""
        const rankTable = [
          `# 相似基金分析报告：${unnamedUpload ? "上传净值曲线产品" : reportSubject}`,
          "",
          "## 相似度排名（系统计算）",
          "",
          ...(uploadCurveLine ? [uploadCurveLine, ""] : []),
          "| 排名 | 产品名称 | 备案号 | 相关性 | 重叠月数 |",
          "| --- | --- | --- | --- | --- |",
          ...topSimilar.map((r, idx) => {
            const corr = r.correlation != null ? r.correlation.toFixed(3) : "N/A"
            return `| ${idx + 1} | ${r.fund.product_name} | ${r.fund.beian_hao} | ${corr} | ${r.overlapMonths} |`
          }),
          "",
          "上表由净值/收益曲线相关性直接计算，下面是基于该名单的文字分析。",
          "",
        ].join("\n")
        emit({ type: "report_text", delta: rankTable })

        const reportModel = getChatModel(true)
        const reportStream = await reportModel.stream([
          new SystemMessage(systemPrompt),
          new HumanMessage(userPrompt),
        ])

        let reportLength = rankTable.length
        for await (const chunk of reportStream) {
          const delta = typeof chunk.content === "string" ? chunk.content : ""
          if (delta) { emit({ type: "report_text", delta }); reportLength += delta.length }
        }

        emit({ type: "step_done", step: 5, summary: `报告生成完成（约 ${reportLength} 字）` })
        emit({ type: "done" })
      } catch (err) {
        console.error("[similar-fund] report error:", err)
        emit({ type: "step_done", step: 5, summary: `报告生成失败：${(err as Error).message}` })
        emit({ type: "error", message: `报告生成失败：${(err as Error).message}` })
      } finally {
        try { controller.close() } catch { /* already closed */ }
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}
