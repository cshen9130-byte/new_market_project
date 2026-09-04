import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { sqlFundNameBase } from "@/lib/server/fund-name-match"
import {
  applyCanonicalManagerNames,
  expandManagerFilterNames,
  mapCanonicalManagerNames,
} from "@/lib/server/manager-name-canonical"
import { enrichPrivateFundListMetrics } from "@/lib/server/private-fund-list-metrics"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Plain AMAC master list (default browse). */
const AMAC_LIST_SOURCE = `private_fund_info i`

/**
 * AMAC + BFL-only rows (share-class tiers from 要素提取 / 分级创建).
 * Used for keyword search so AJD58B-style products are findable; browse stays AMAC-only.
 * BFL-only rows have no stored manager; inheritShareClassParentFields fills it from the parent.
 */
const SEARCH_LIST_SOURCE = `(
  SELECT
    beian_hao,
    product_name,
    strategy_l1,
    manager,
    inception_date,
    benchmark,
    ret_1w,
    ret_1m,
    ret_3m,
    ret_6m,
    ret_1y,
    sharpe_1y,
    calmar_1y,
    latest_nav,
    latest_nav_date
  FROM private_fund_info
  UNION ALL
  SELECT
    b.beian_hao,
    b.product_name,
    b.strategy_one AS strategy_l1,
    ''::text AS manager,
    NULL::date AS inception_date,
    NULL::text AS benchmark,
    NULL AS ret_1w,
    NULL AS ret_1m,
    NULL AS ret_3m,
    NULL AS ret_6m,
    NULL AS ret_1y,
    NULL AS sharpe_1y,
    NULL AS calmar_1y,
    NULL AS latest_nav,
    NULL AS latest_nav_date
  FROM private_fund_info_bfl b
  WHERE NOT EXISTS (
    SELECT 1 FROM private_fund_info p WHERE p.beian_hao = b.beian_hao
  )
) i`

const ALLOWED_SORT: Record<string, string> = {
  product_name: "i.product_name",
  inception_date: "i.inception_date",
  latest_nav: "i.latest_nav",
  ret_1w: "i.ret_1w",
  ret_1m: "i.ret_1m",
  ret_3m: "i.ret_3m",
  ret_6m: "i.ret_6m",
  ret_1y: "i.ret_1y",
  sharpe_1y: "i.sharpe_1y",
  calmar_1y: "i.calmar_1y",
}

type FundListRow = {
  beian_hao: string
  product_name: string
  strategy_l1: string | null
  manager: string
  inception_date: string | null
  benchmark: string | null
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

function shareClassParentCodes(beianHao: string): string[] {
  const raw = beianHao.trim().toUpperCase()
  const base = raw.replace(/[ABC]$/u, "")
  if (!base) return []
  return [...new Set([`S${base}`, base, base.replace(/^S/u, "")].filter(Boolean))]
}

function fundNameBaseForParent(name: string): string {
  return name
    .trim()
    .replace(/[ABC]类份额$/u, "")
    .replace(/[ABC]类$/u, "")
    .replace(/(私募证券投资基金|私募基金|证券投资基金|投资基金)$/u, "")
    .trim()
}

/** BFL-only A/B/C rows store no manager — copy it from the parent AMAC fund. */
async function inheritShareClassParentFields<T extends FundListRow>(rows: T[]): Promise<T[]> {
  const missing = rows.filter((row) => !row.manager?.trim())
  if (missing.length === 0) return rows

  const parentCodes = new Set<string>()
  const childCandidates = new Map<string, string[]>()
  for (const row of missing) {
    const candidates = shareClassParentCodes(row.beian_hao)
    childCandidates.set(row.beian_hao, candidates)
    for (const code of candidates) parentCodes.add(code)
  }

  const byCode = new Map<string, { manager: string; inception_date: string | null }>()
  if (parentCodes.size > 0) {
    const parents = await query<{ beian_hao: string; manager: string; inception_date: string | null }>(
      `SELECT beian_hao, manager, inception_date::text AS inception_date
       FROM private_fund_info
       WHERE beian_hao = ANY($1::text[])
         AND manager IS NOT NULL AND BTRIM(manager) <> ''`,
      [[...parentCodes]],
    )
    for (const parent of parents) {
      byCode.set(parent.beian_hao.trim().toUpperCase(), {
        manager: parent.manager.trim(),
        inception_date: parent.inception_date,
      })
    }
  }

  const stillMissing = missing.filter((row) => {
    const candidates = childCandidates.get(row.beian_hao) ?? []
    return !candidates.some((code) => byCode.has(code.toUpperCase()))
  })

  const byName = new Map<string, { manager: string; inception_date: string | null }>()
  if (stillMissing.length > 0) {
    const bases = [...new Set(stillMissing.map((row) => fundNameBaseForParent(row.product_name)).filter((n) => n.length >= 2))]
    if (bases.length > 0) {
      const nameParents = await query<{ product_name: string; manager: string; inception_date: string | null }>(
        `SELECT product_name, manager, inception_date::text AS inception_date
         FROM private_fund_info
         WHERE manager IS NOT NULL AND BTRIM(manager) <> ''
           AND ${sqlFundNameBase("product_name")} = ANY($1::text[])`,
        [bases],
      )
      for (const parent of nameParents) {
        const key = fundNameBaseForParent(parent.product_name)
        if (key && !byName.has(key)) {
          byName.set(key, { manager: parent.manager.trim(), inception_date: parent.inception_date })
        }
      }
    }
  }

  return rows.map((row) => {
    if (row.manager?.trim()) return row
    const fromCode = (childCandidates.get(row.beian_hao) ?? [])
      .map((code) => byCode.get(code.toUpperCase()))
      .find(Boolean)
    const fromName = byName.get(fundNameBaseForParent(row.product_name))
    const parent = fromCode ?? fromName
    if (!parent) return row
    return {
      ...row,
      manager: parent.manager,
      inception_date: row.inception_date ?? parent.inception_date,
    }
  })
}

/** Prefer materialized NAV columns when cutoff is today or later (no NAV table scan). */
function useStoredNav(cutoffDate: string | null): boolean {
  if (!cutoffDate) return true
  const today = new Date().toISOString().slice(0, 10)
  return cutoffDate >= today
}

async function fetchHistoricalNavMap(
  beianHaos: string[],
  cutoffDate: string,
): Promise<Map<string, { nav: string; price_date: string }>> {
  if (beianHaos.length === 0) return new Map()
  const rows = await query<{ beian_hao: string; nav: string; price_date: string }>(
    `SELECT DISTINCT ON (beian_hao)
       beian_hao,
       nav::text AS nav,
       price_date::text AS price_date
     FROM private_fund_nav
     WHERE beian_hao = ANY($1::text[])
       AND price_date <= $2::date
       AND nav IS NOT NULL AND nav > 0
     ORDER BY beian_hao, price_date DESC`,
    [beianHaos, cutoffDate],
  )
  return new Map(rows.map((r) => [r.beian_hao, { nav: r.nav, price_date: r.price_date }]))
}

function attachHistoricalNav(
  rows: Omit<FundListRow, "latest_nav" | "latest_nav_date">[],
  navMap: Map<string, { nav: string; price_date: string }>,
): FundListRow[] {
  return rows.map((row) => {
    const nav = navMap.get(row.beian_hao)
    return {
      ...row,
      latest_nav: nav?.nav ?? null,
      latest_nav_date: nav?.price_date ?? null,
    }
  })
}

const BASE_SELECT = `
  i.beian_hao,
  i.product_name,
  i.strategy_l1,
  i.manager,
  i.inception_date,
  i.benchmark,
  i.ret_1w::text AS ret_1w,
  i.ret_1m::text AS ret_1m,
  i.ret_3m::text AS ret_3m,
  i.ret_6m::text AS ret_6m,
  i.ret_1y::text AS ret_1y,
  i.sharpe_1y::text AS sharpe_1y,
  i.calmar_1y::text AS calmar_1y
`

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
  const isExport = searchParams.get("export") === "1"
  const pageSize = isExport ? 100000 : 50
  const offset = isExport ? 0 : (page - 1) * pageSize
  const sortKey = searchParams.get("sort") || "inception_date"
  const sortDir = (searchParams.get("dir") ?? "desc") === "desc" ? "DESC" : "ASC"
  const strategy = searchParams.get("strategy") || ""
  const strategiesRaw = searchParams.get("strategies") || strategy
  const strategies = strategiesRaw ? strategiesRaw.split(",").map((s) => s.trim()).filter(Boolean) : []
  const sfRaw = searchParams.getAll("sf")
  const sfFilters: { l1: string; l2s: string[] }[] = sfRaw.length > 0
    ? sfRaw.map((s) => {
        const ci = s.indexOf(":")
        if (ci === -1) return { l1: s, l2s: [] }
        return { l1: s.slice(0, ci), l2s: s.slice(ci + 1).split(",").filter(Boolean) }
      })
    : strategies.map((l1) => ({ l1, l2s: [] }))
  const keyword = (searchParams.get("keyword") || "").trim()
  const manager = (searchParams.get("manager") || "").trim()
  const inceptionPeriod = (searchParams.get("inception") || "").trim()
  const navDatePeriod = (searchParams.get("navdate") || "").trim()
  const navFrequency = (searchParams.get("navfreq") || "").trim()
  const metricTab = searchParams.get("metric") || "收益"
  const period = searchParams.get("period") || "本周"
  const range = searchParams.get("range") || "不限"
  const cutoffRaw = (searchParams.get("cutoff") || "").trim()
  const cutoffDate = /^\d{4}-\d{2}-\d{2}$/.test(cutoffRaw) ? cutoffRaw : null
  const preferStored = useStoredNav(cutoffDate)

  const PERIOD_COL: Record<string, string> = {
    "本周": "i.ret_1w", "近一周": "i.ret_1w",
    "本月": "i.ret_1m", "近一月": "i.ret_1m",
    "近三月": "i.ret_3m", "近六月": "i.ret_6m",
    "近一年": "i.ret_1y", "近两年": "i.ret_1y", "近三年": "i.ret_1y", "近五年": "i.ret_1y",
    "今年以来": "i.ret_1y", "成立以来": "i.ret_1y",
    "2018": "i.ret_1y", "2019": "i.ret_1y", "2020": "i.ret_1y",
    "2021": "i.ret_1y", "2022": "i.ret_1y", "2023": "i.ret_1y", "2024": "i.ret_1y",
  }
  const METRIC_COL: Record<string, string> = {
    "夏普比率": "i.sharpe_1y", "夏普比率排名": "i.sharpe_1y",
    "卡玛比率": "i.calmar_1y", "卡玛比率排名": "i.calmar_1y",
  }
  const metricCol = METRIC_COL[metricTab] ?? PERIOD_COL[period] ?? "i.ret_1w"

  const RANGE_BOUNDS: Record<string, [number | null, number | null]> = {
    "不限": [null, null],
    "0%~5%": [0, 5],
    "5%~10%": [5, 10],
    "10%~20%": [10, 20],
    "20%~30%": [20, 30],
    ">30%": [30, null],
    "10%~15%": [10, 15],
    "15%~20%": [15, 20],
    ">20%": [20, null],
    "0~1": [0, 1],
    "1~2": [1, 2],
    "2~3": [2, 3],
    "3~5": [3, 5],
    ">5": [5, null],
    "前5%": [null, null],
    "前10%": [null, null],
    "前25%": [null, null],
    "前50%": [null, null],
    "前75%": [null, null],
    "自定义": [null, null],
  }
  const [rangeMin, rangeMax] = RANGE_BOUNDS[range] ?? [null, null]
  const rankPctMap: Record<string, number> = {
    "前5%": 0.05, "前10%": 0.10, "前25%": 0.25, "前50%": 0.50, "前75%": 0.75,
  }
  const rankPct = metricTab.includes("排名") ? (rankPctMap[range] ?? null) : null

  const filterParams: (string | number | string[])[] = []
  const where: string[] = []
  if (sfFilters.length > 0) {
    const sfClauses: string[] = []
    for (const f of sfFilters) {
      if (f.l2s.length === 0) {
        filterParams.push(f.l1)
        sfClauses.push(`i.strategy_l1 = $${filterParams.length}`)
      } else {
        filterParams.push(f.l1)
        const idxL1 = filterParams.length
        filterParams.push(f.l2s)
        const idxL2 = filterParams.length
        sfClauses.push(`(i.strategy_l1 = $${idxL1} AND i.strategy_l2 = ANY($${idxL2}))`)
      }
    }
    where.push(`(${sfClauses.join(" OR ")})`)
  }
  if (keyword) {
    filterParams.push(`%${keyword}%`)
    where.push(`(i.product_name ILIKE $${filterParams.length} OR i.beian_hao ILIKE $${filterParams.length})`)
  }
  if (manager) {
    const aliases = await expandManagerFilterNames(manager)
    filterParams.push(aliases.length > 0 ? aliases : [manager])
    where.push(`i.manager = ANY($${filterParams.length})`)
  }
  if (inceptionPeriod && inceptionPeriod !== "不限" && inceptionPeriod !== "自定义") {
    const INCEPTION_SQL: Record<string, string> = {
      "6个月以内": `i.inception_date >= CURRENT_DATE - INTERVAL '6 months'`,
      "6个月-1年": `i.inception_date >= CURRENT_DATE - INTERVAL '1 year' AND i.inception_date < CURRENT_DATE - INTERVAL '6 months'`,
      "1-3年": `i.inception_date >= CURRENT_DATE - INTERVAL '3 years' AND i.inception_date < CURRENT_DATE - INTERVAL '1 year'`,
      "3-5年": `i.inception_date >= CURRENT_DATE - INTERVAL '5 years' AND i.inception_date < CURRENT_DATE - INTERVAL '3 years'`,
      "5年以上": `i.inception_date < CURRENT_DATE - INTERVAL '5 years'`,
    }
    const sql = INCEPTION_SQL[inceptionPeriod]
    if (sql) where.push(sql)
  }
  if (navDatePeriod && navDatePeriod !== "不限" && navDatePeriod !== "自定义") {
    if (preferStored) {
      const NAV_DATE_COL: Record<string, string> = {
        "1个月以内": `i.latest_nav_date >= CURRENT_DATE - INTERVAL '1 month'`,
        "1-3个月": `i.latest_nav_date >= CURRENT_DATE - INTERVAL '3 months' AND i.latest_nav_date < CURRENT_DATE - INTERVAL '1 month'`,
        "3-6个月": `i.latest_nav_date >= CURRENT_DATE - INTERVAL '6 months' AND i.latest_nav_date < CURRENT_DATE - INTERVAL '3 months'`,
        "6个月以内": `i.latest_nav_date >= CURRENT_DATE - INTERVAL '6 months'`,
        "6个月以上": `i.latest_nav_date < CURRENT_DATE - INTERVAL '6 months'`,
      }
      const colSql = NAV_DATE_COL[navDatePeriod]
      if (colSql) where.push(colSql)
    } else {
      const NAV_DATE_SUBQUERY: Record<string, string> = {
        "1个月以内": `MAX(price_date) >= CURRENT_DATE - INTERVAL '1 month'`,
        "1-3个月": `MAX(price_date) >= CURRENT_DATE - INTERVAL '3 months' AND MAX(price_date) < CURRENT_DATE - INTERVAL '1 month'`,
        "3-6个月": `MAX(price_date) >= CURRENT_DATE - INTERVAL '6 months' AND MAX(price_date) < CURRENT_DATE - INTERVAL '3 months'`,
        "6个月以内": `MAX(price_date) >= CURRENT_DATE - INTERVAL '6 months'`,
        "6个月以上": `MAX(price_date) < CURRENT_DATE - INTERVAL '6 months'`,
      }
      const subSql = NAV_DATE_SUBQUERY[navDatePeriod]
      if (subSql) {
        where.push(`i.beian_hao IN (
          SELECT beian_hao FROM private_fund_nav
          GROUP BY beian_hao HAVING ${subSql}
        )`)
      }
    }
  }
  if (navFrequency && navFrequency !== "不限") {
    const FREQ_HAVING: Record<string, string> = {
      "日频": "AVG(gap) < 3",
      "周频": "AVG(gap) >= 3 AND AVG(gap) < 10",
      "月频": "AVG(gap) >= 10",
    }
    const freqHaving = FREQ_HAVING[navFrequency]
    if (freqHaving) {
      where.push(`i.beian_hao IN (
        SELECT beian_hao FROM (
          SELECT beian_hao,
            price_date - LAG(price_date) OVER (PARTITION BY beian_hao ORDER BY price_date) AS gap
          FROM private_fund_nav
        ) _gaps WHERE gap IS NOT NULL
        GROUP BY beian_hao HAVING ${freqHaving}
      )`)
    }
  }
  if (rangeMin !== null) {
    filterParams.push(rangeMin)
    where.push(`${metricCol}::numeric >= $${filterParams.length}`)
  }
  if (rangeMax !== null) {
    filterParams.push(rangeMax)
    where.push(`${metricCol}::numeric < $${filterParams.length}`)
  }
  if (rankPct !== null) {
    const isAscMetric = metricTab.startsWith("最大回撤") || metricTab.startsWith("年化波动率")
    const rankOrder = isAscMetric ? "ASC NULLS LAST" : "DESC NULLS LAST"
    const bareCol = metricCol.replace(/^i\./, "")
    filterParams.push(rankPct)
    where.push(`i.beian_hao IN (
      SELECT beian_hao FROM (
        SELECT beian_hao, PERCENT_RANK() OVER (ORDER BY ${bareCol} ${rankOrder}) AS prank
        FROM ${keyword ? SEARCH_LIST_SOURCE : AMAC_LIST_SOURCE}
      ) _r WHERE _r.prank < $${filterParams.length}
    )`)
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : ""
  const listSource = keyword ? SEARCH_LIST_SOURCE : AMAC_LIST_SOURCE

  async function fetchList(storedNav: boolean) {
    const listParams = [...filterParams]
    let cutoffParamIdx: number | null = null
    if (!storedNav && cutoffDate) {
      listParams.push(cutoffDate)
      cutoffParamIdx = listParams.length
    }

    const pLimit = listParams.length + 1
    const pOffset = listParams.length + 2
    const orderCol = sortKey === "latest_nav" && !storedNav
      ? "fn.nav"
      : (ALLOWED_SORT[sortKey] ?? "i.inception_date")
    const orderSql = `${orderCol} ${sortDir} NULLS LAST`

    const countPromise = query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM ${listSource} ${whereClause}`,
      filterParams,
    )

    // ─── FAST PATH — read precomputed latest_nav from list source ─────────────
    if (storedNav) {
      const [rows, countRow] = await Promise.all([
        query<FundListRow>(
          `SELECT
             ${BASE_SELECT},
             i.latest_nav::text AS latest_nav,
             i.latest_nav_date::text AS latest_nav_date
           FROM ${listSource}
           ${whereClause}
           ORDER BY ${orderSql}
           LIMIT $${pLimit} OFFSET $${pOffset}`,
          [...listParams, pageSize, offset],
        ),
        countPromise,
      ])
      const total = parseInt(countRow[0]?.total ?? "0", 10)
      return {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        data: rows,
      }
    }

    // ─── Historical cutoff + sort by NAV — single query with indexed lookup ───
    if (sortKey === "latest_nav" || isExport) {
      const cutoffClause = cutoffParamIdx ? `AND n.price_date <= $${cutoffParamIdx}` : ""
      const [rows, countRow] = await Promise.all([
        query<FundListRow>(
          `SELECT
             ${BASE_SELECT},
             fn.nav::text AS latest_nav,
             fn.price_date::text AS latest_nav_date
           FROM ${listSource}
           LEFT JOIN LATERAL (
             SELECT n.nav, n.price_date
             FROM private_fund_nav n
             WHERE n.beian_hao = i.beian_hao
               ${cutoffClause}
               AND n.nav IS NOT NULL AND n.nav > 0
             ORDER BY n.price_date DESC
             LIMIT 1
           ) fn ON true
           ${whereClause}
           ORDER BY ${orderSql}
           LIMIT $${pLimit} OFFSET $${pOffset}`,
          [...listParams, pageSize, offset],
        ),
        countPromise,
      ])
      const total = parseInt(countRow[0]?.total ?? "0", 10)
      return {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        data: rows,
      }
    }

    // ─── Historical cutoff — paginate first, batch-fetch NAV for page only ────
    const pageParams = [...filterParams, pageSize, offset]
    const pPageLimit = filterParams.length + 1
    const pPageOffset = filterParams.length + 2
    const [baseRows, countRow] = await Promise.all([
      query<Omit<FundListRow, "latest_nav" | "latest_nav_date">>(
        `SELECT ${BASE_SELECT}
         FROM ${listSource}
         ${whereClause}
         ORDER BY ${orderSql}
         LIMIT $${pPageLimit} OFFSET $${pPageOffset}`,
        pageParams,
      ),
      countPromise,
    ])
    const total = parseInt(countRow[0]?.total ?? "0", 10)
    if (!cutoffDate || baseRows.length === 0) {
      return {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        data: baseRows.map((row) => ({ ...row, latest_nav: null, latest_nav_date: null })),
      }
    }

    const navMap = await fetchHistoricalNavMap(
      baseRows.map((r) => r.beian_hao),
      cutoffDate,
    )

    return {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      data: attachHistoricalNav(baseRows, navMap),
    }
  }

  try {
    // Always paginate from precomputed private_fund_info; apply cutoff in enrichPrivateFundListMetrics.
    let payload
    try {
      payload = await fetchList(true)
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      if (!/latest_nav/i.test(message)) throw e
      payload = await fetchList(false)
    }
    payload.data = await enrichPrivateFundListMetrics(payload.data, cutoffDate)
    payload.data = await inheritShareClassParentFields(payload.data)
    const canonicalMap = await mapCanonicalManagerNames(payload.data.map((row) => row.manager))
    payload.data = applyCanonicalManagerNames(payload.data, canonicalMap)
    return NextResponse.json(payload)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to load private funds"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
