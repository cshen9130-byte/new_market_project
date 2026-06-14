import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ALLOWED_SORT: Record<string, string> = {
  product_name: "i.product_name",
  latest_nav:   "fn.nav",
  ret_1w:       "i.ret_1w",
  ret_1m:       "i.ret_1m",
  ret_3m:       "i.ret_3m",
  ret_6m:       "i.ret_6m",
  ret_1y:       "i.ret_1y",
  sharpe_1y:    "i.sharpe_1y",
  calmar_1y:    "i.calmar_1y",
}

/** Prefer materialized NAV columns when cutoff is today or later (no NAV table scan). */
function useStoredNav(cutoffDate: string | null): boolean {
  if (!cutoffDate) return true
  const today = new Date().toISOString().slice(0, 10)
  return cutoffDate >= today
}

function buildNavParts(storedNav: boolean, cutoffParamIdx: number | null) {
  if (storedNav) {
    return {
      select: `i.latest_nav::text AS latest_nav,
               i.latest_nav_date::text AS latest_nav_date`,
      join: "",
      sortCol: "i.latest_nav",
    }
  }
  const cutoffClause = cutoffParamIdx
    ? `AND n.price_date <= $${cutoffParamIdx}`
    : ""
  return {
    select: `fn.nav::text AS latest_nav,
             fn.price_date::text AS latest_nav_date`,
    join: `LEFT JOIN LATERAL (
      SELECT n.nav, n.price_date
      FROM private_fund_nav n
      WHERE n.beian_hao = i.beian_hao
        ${cutoffClause}
      ORDER BY n.price_date DESC
      LIMIT 1
    ) fn ON true`,
    sortCol: "fn.nav",
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const page     = Math.max(1, parseInt(searchParams.get("page") || "1"))
  const isExport = searchParams.get("export") === "1"
  const pageSize = isExport ? 100000 : 50
  const offset   = isExport ? 0 : (page - 1) * pageSize
  const sortKey  = searchParams.get("sort") || "product_name"
  const sortDir  = searchParams.get("dir") === "desc" ? "DESC" : "ASC"
  const strategy  = searchParams.get("strategy") || ""
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
  const keyword  = (searchParams.get("keyword") || "").trim()
  const inceptionPeriod = (searchParams.get("inception") || "").trim()
  const navDatePeriod   = (searchParams.get("navdate") || "").trim()
  const navFrequency    = (searchParams.get("navfreq") || "").trim()
  const metricTab  = searchParams.get("metric") || "收益"
  const period     = searchParams.get("period") || "本周"
  const range      = searchParams.get("range") || "不限"
  const cutoffRaw  = (searchParams.get("cutoff") || "").trim()
  const cutoffDate = /^\d{4}-\d{2}-\d{2}$/.test(cutoffRaw) ? cutoffRaw : null

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
    "不限":     [null, null],
    "0%~5%":   [0, 5],
    "5%~10%":  [5, 10],
    "10%~20%": [10, 20],
    "20%~30%": [20, 30],
    ">30%":    [30, null],
    "10%~15%": [10, 15],
    "15%~20%": [15, 20],
    ">20%":    [20, null],
    "0~1":     [0, 1],
    "1~2":     [1, 2],
    "2~3":     [2, 3],
    "3~5":     [3, 5],
    ">5":      [5, null],
    "前5%":  [null, null],
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
  if (inceptionPeriod && inceptionPeriod !== "不限" && inceptionPeriod !== "自定义") {
    const INCEPTION_SQL: Record<string, string> = {
      "6个月以内": `i.inception_date >= CURRENT_DATE - INTERVAL '6 months'`,
      "6个月-1年":  `i.inception_date >= CURRENT_DATE - INTERVAL '1 year' AND i.inception_date < CURRENT_DATE - INTERVAL '6 months'`,
      "1-3年":     `i.inception_date >= CURRENT_DATE - INTERVAL '3 years' AND i.inception_date < CURRENT_DATE - INTERVAL '1 year'`,
      "3-5年":     `i.inception_date >= CURRENT_DATE - INTERVAL '5 years' AND i.inception_date < CURRENT_DATE - INTERVAL '3 years'`,
      "5年以上":   `i.inception_date < CURRENT_DATE - INTERVAL '5 years'`,
    }
    const sql = INCEPTION_SQL[inceptionPeriod]
    if (sql) where.push(sql)
  }
  if (navDatePeriod && navDatePeriod !== "不限" && navDatePeriod !== "自定义") {
    const NAV_DATE_SUBQUERY: Record<string, string> = {
      "1个月以内": `MAX(price_date) >= CURRENT_DATE - INTERVAL '1 month'`,
      "1-3个月":   `MAX(price_date) >= CURRENT_DATE - INTERVAL '3 months' AND MAX(price_date) < CURRENT_DATE - INTERVAL '1 month'`,
      "3-6个月":   `MAX(price_date) >= CURRENT_DATE - INTERVAL '6 months' AND MAX(price_date) < CURRENT_DATE - INTERVAL '3 months'`,
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
        FROM private_fund_info
      ) _r WHERE _r.prank < $${filterParams.length}
    )`)
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : ""

  async function fetchList(storedNav: boolean) {
    let cutoffParamIdx: number | null = null
    const listParams = [...filterParams]
    if (!storedNav && cutoffDate) {
      listParams.push(cutoffDate)
      cutoffParamIdx = listParams.length
    }

    const pLimit = listParams.length + 1
    const pOffset = listParams.length + 2
    const nav = buildNavParts(storedNav, cutoffParamIdx)
    const orderCol = sortKey === "latest_nav" ? nav.sortCol : (ALLOWED_SORT[sortKey] ?? "i.product_name")
    const orderSql = `${orderCol} ${sortDir} NULLS LAST`

    const [rows, countRow] = await Promise.all([
      query<{
        beian_hao:      string
        product_name:   string
        strategy_l1:    string | null
        manager:        string
        inception_date: string | null
        benchmark:      string | null
        ret_1w:         string | null
        ret_1m:         string | null
        ret_3m:         string | null
        ret_6m:         string | null
        ret_1y:         string | null
        sharpe_1y:      string | null
        calmar_1y:      string | null
        latest_nav:     string | null
        latest_nav_date: string | null
      }>(
        `SELECT
           i.beian_hao,
           i.product_name,
           i.strategy_l1,
           i.manager,
           i.inception_date,
           i.benchmark,
           i.ret_1w,
           i.ret_1m,
           i.ret_3m,
           i.ret_6m,
           i.ret_1y,
           i.sharpe_1y,
           i.calmar_1y,
           ${nav.select}
         FROM private_fund_info i
         ${nav.join}
         ${whereClause}
         ORDER BY ${orderSql}
         LIMIT $${pLimit} OFFSET $${pOffset}`,
        [...listParams, pageSize, offset]
      ),
      query<{ total: string }>(
        `SELECT COUNT(*) AS total FROM private_fund_info i ${whereClause}`,
        filterParams
      ),
    ])

    return {
      page,
      pageSize,
      total: parseInt(countRow[0]?.total ?? "0"),
      totalPages: Math.ceil(parseInt(countRow[0]?.total ?? "0") / pageSize),
      data: rows,
    }
  }

  try {
    const preferStored = useStoredNav(cutoffDate)
    if (preferStored) {
      try {
        return NextResponse.json(await fetchList(true))
      } catch (e: any) {
        // Columns not migrated yet — fall back to per-row LATERAL lookup
        if (!/latest_nav/i.test(String(e?.message ?? ""))) throw e
      }
    }
    return NextResponse.json(await fetchList(false))
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
