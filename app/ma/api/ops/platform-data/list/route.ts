import { NextResponse } from "next/server"
import { withListResponseCache } from "@/lib/server/list-response-cache"
import { listPlatformPrivateFunds } from "@/lib/server/platform-data-query-pg"

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
    const sourceRaw = (searchParams.get("product_source") || "").trim().toLowerCase()
    const productSourceFilter =
      sourceRaw === "manual" || sourceRaw === "email" ? sourceRaw : "all"
    const operationDateRaw = (searchParams.get("operation_date") || "").trim().toLowerCase()
    const operationDateFilter =
      operationDateRaw === "present" || operationDateRaw === "absent" ? operationDateRaw : "all"
    const classRaw = (searchParams.get("product_class") || "").trim().toLowerCase()
    const productClassFilter =
      classRaw === "private" || classRaw === "asset" || classRaw === "trust" || classRaw === "equity"
        ? classRaw
        : "all"
    const navPresenceRaw = (searchParams.get("nav_presence") || "").trim().toLowerCase()
    const navPresenceFilter =
      navPresenceRaw === "present" || navPresenceRaw === "absent" ? navPresenceRaw : "all"
    const navDateRaw = (searchParams.get("nav_date") || "").trim().toLowerCase()
    const navDateFilter =
      navDateRaw === "m1" || navDateRaw === "m1_3" || navDateRaw === "m3_6" || navDateRaw === "within_m6" || navDateRaw === "over_m6"
        ? navDateRaw
        : "all"
    const sort = (searchParams.get("sort") || "").trim()
    const sortDir = searchParams.get("dir") === "asc" ? "ASC" : "DESC"

    const cacheKey = JSON.stringify({
      pool: "ops-platform-data",
      v: "nav_date_buckets",
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
      productSourceFilter,
      operationDateFilter,
      productClassFilter,
      navPresenceFilter,
      navDateFilter,
      sort,
      sortDir,
    })

    const body = await withListResponseCache(cacheKey, async () => {
      const result = await listPlatformPrivateFunds({
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
        productSourceFilter,
        operationDateFilter,
        productClassFilter,
        navPresenceFilter,
        navDateFilter,
        sort,
        sortDir,
      })
      return {
        ...result,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(result.total / pageSize)),
      }
    })

    return NextResponse.json(body)
  } catch (err) {
    console.error("[platform-data/list]", err)
    return NextResponse.json({ error: "Failed to load platform data" }, { status: 500 })
  }
}
