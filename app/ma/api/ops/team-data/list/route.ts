import { NextResponse } from "next/server"
import { withListResponseCache } from "@/lib/server/list-response-cache"
import { parseNavFrequencyFilter } from "@/lib/server/nav-frequency"
import { listTeamData } from "@/lib/server/team-data-query-pg"

export const runtime = "nodejs"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)))
    const keyword = (searchParams.get("keyword") || "").trim()
    const strategySource = searchParams.get("strategy_source") === "platform" ? "platform" : "company"
    const strategyL1 = (searchParams.get("strategy_l1") || "").trim()
    const strategyL2 = (searchParams.get("strategy_l2") || "").trim()
    const strategyL3 = (searchParams.get("strategy_l3") || "").trim()
    const elementsRaw = (searchParams.get("elements") || "").trim().toLowerCase()
    const elementsFilter =
      elementsRaw === "missing" || elementsRaw === "present" ? elementsRaw : "all"
    const navLagRaw = (searchParams.get("nav_lag") || "").trim().toLowerCase()
    const navLagFilter =
      navLagRaw === "behind_2w" || navLagRaw === "within_2w" ? navLagRaw : "all"
    const navGapRaw = (searchParams.get("nav_gap") || "").trim().toLowerCase()
    const navGapFilter =
      navGapRaw === "interior_2w" || navGapRaw === "no_interior_2w" ? navGapRaw : "all"
    const navAnomalyRaw = (searchParams.get("nav_anomaly") || "").trim().toLowerCase()
    const navAnomalyFilter =
      navAnomalyRaw === "jump" || navAnomalyRaw === "no_jump" ? navAnomalyRaw : "all"
    const navAnomalyCauseRaw = (searchParams.get("nav_anomaly_cause") || "").trim().toLowerCase()
    const navAnomalyCauseFilter =
      navAnomalyFilter === "jump" && (navAnomalyCauseRaw === "source" || navAnomalyCauseRaw === "rules")
        ? navAnomalyCauseRaw
        : "all"
    const sourceRaw = (searchParams.get("product_source") || "").trim().toLowerCase()
    const productSourceFilter =
      sourceRaw === "manual" || sourceRaw === "email" || sourceRaw === "fof99" ? sourceRaw : "all"
    const operationDateRaw = (searchParams.get("operation_date") || "").trim().toLowerCase()
    const operationDateFilter =
      operationDateRaw === "present" || operationDateRaw === "absent" ? operationDateRaw : "all"
    const inceptionNavRaw = (searchParams.get("inception_nav") || "").trim().toLowerCase()
    const inceptionNavFilter =
      inceptionNavRaw === "match" || inceptionNavRaw === "mismatch" || inceptionNavRaw === "missing"
        ? inceptionNavRaw
        : "all"
    const inceptionNavGapRaw = (searchParams.get("inception_nav_gap") || "").trim().toLowerCase()
    const inceptionNavGapFilter =
      inceptionNavFilter === "mismatch"
      && (inceptionNavGapRaw === "w2" || inceptionNavGapRaw === "w2_m1" || inceptionNavGapRaw === "m1_3" || inceptionNavGapRaw === "m3_6" || inceptionNavGapRaw === "m6_12" || inceptionNavGapRaw === "over_y1")
        ? inceptionNavGapRaw
        : "all"
    const navStartValueRaw = (searchParams.get("nav_start_value") || "").trim().toLowerCase()
    const navStartValueFilter =
      inceptionNavFilter !== "all"
      && (navStartValueRaw === "near_1" || navStartValueRaw === "away_1" || navStartValueRaw === "missing")
        ? navStartValueRaw
        : "all"
    const navFrequencyFilter = parseNavFrequencyFilter(searchParams.get("nav_frequency") || "")
    const sort = (searchParams.get("sort") || "").trim()
    const sortDir = searchParams.get("dir") === "asc" ? "ASC" : "DESC"

    try {
      const { ensureFofUnderlyingInEmailPool } = await import("@/lib/server/fof-email-product-sync")
      await ensureFofUnderlyingInEmailPool()
    } catch (err) {
      console.warn("[team-data/list] FOF→邮箱池 sync skipped:", err)
    }

    const cacheKey = JSON.stringify({
      pool: "ops-team-data",
      v: "nav_frequency_v2",
      page,
      pageSize,
      keyword,
      strategySource,
      strategyL1,
      strategyL2,
      strategyL3,
      elementsFilter,
      navLagFilter,
      navGapFilter,
      navAnomalyFilter,
      navAnomalyCauseFilter,
      productSourceFilter,
      operationDateFilter,
      inceptionNavFilter,
      inceptionNavGapFilter,
      navStartValueFilter,
      navFrequencyFilter,
      sort,
      sortDir,
    })

    const body = await withListResponseCache(cacheKey, async () => {
      const { data, total } = await listTeamData({
        page,
        pageSize,
        keyword,
        strategySource,
        strategyL1,
        strategyL2,
        strategyL3,
        elementsFilter,
        navLagFilter,
        navGapFilter,
        navAnomalyFilter,
        navAnomalyCauseFilter,
        productSourceFilter,
        operationDateFilter,
        inceptionNavFilter,
        inceptionNavGapFilter,
        navStartValueFilter,
        navFrequencyFilter,
        sort,
        sortDir,
      })
      return {
        data,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      }
    })

    return NextResponse.json(body)
  } catch (err) {
    console.error("[team-data/list]", err)
    return NextResponse.json({ error: "Failed to load team data" }, { status: 500 })
  }
}
