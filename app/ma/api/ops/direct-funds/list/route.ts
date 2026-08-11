import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { EMAIL_OPS_POOL_KEY } from "@/lib/server/email-tracking-pool-sync"
import {
  resolveEmailPoolRegistersForCrawlEmails,
  resolveVisibleEmailPoolRegistersForUser,
} from "@/lib/server/direct-email-visibility"
import { getUserById } from "@/lib/server/users"
import { ensureTrackingFundsListCachePopulated } from "@/lib/server/tracking-funds-list-cache-pg"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * 直投产品 list — backed by email-synced products (邮箱运维池 / custom_email_nav),
 * filtered by 直投设置 crawl-email → account visibility.
 * Admin sees all; linked mailbox products are visible only to the linked account.
 * Optional `crawl_email` query param (admin only) further filters by fetch mailbox.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)))
    const keyword = (searchParams.get("keyword") || "").trim()
    const strategyL1 = (searchParams.get("strategy_l1") || "").trim()
    const strategySource = (searchParams.get("strategy_source") || "platform").trim().toLowerCase()
    const sortKey = (searchParams.get("sort") || "product_name").trim()
    const sortDir = searchParams.get("dir") === "asc" ? "ASC" : "DESC"
    const crawlEmail = (searchParams.get("crawl_email") || "").trim().toLowerCase()
    const userId = String(req.headers.get("x-market-user-id") || "").trim()

    const user = userId ? await getUserById(userId).catch(() => null) : null
    const isAdmin = user?.role === "admin"

    if (crawlEmail && !isAdmin) {
      return NextResponse.json(
        { error: "仅系统管理员可按抓取邮箱筛选", data: [], total: 0, page, pageSize, totalPages: 1 },
        { status: 403 },
      )
    }

    let emailVisibilityRegisters: string[] | null = null
    if (userId) {
      emailVisibilityRegisters = await resolveVisibleEmailPoolRegistersForUser({
        userId,
        isAdmin,
      })
    }

    if (crawlEmail) {
      const emailRegisters = await resolveEmailPoolRegistersForCrawlEmails([crawlEmail])
      if (emailVisibilityRegisters === null) {
        emailVisibilityRegisters = emailRegisters
      } else {
        const allow = new Set(emailRegisters.map((r) => r.trim().toUpperCase()))
        emailVisibilityRegisters = emailVisibilityRegisters.filter((r) =>
          allow.has(r.trim().toUpperCase()),
        )
      }
    }

    await ensureTrackingFundsListCachePopulated().catch(() => {})

    const strategyL1Col =
      strategySource === "company" ? "cache.company_strategy_l1" : "cache.platform_strategy_l1"
    const strategyL2Col =
      strategySource === "company" ? "cache.company_strategy_l2" : "cache.platform_strategy_l2"

    const allowedSort: Record<string, string> = {
      product_name: "i.product_name",
      latest_nav_date: "cache.nav_date",
      latest_nav: "cache.unit_nav",
      latest_price_change: "cache.return_pct",
      ret_1w: "cache.ret_1w",
      ret_1m: "cache.ret_1m",
      ret_3m: "cache.ret_3m",
      ret_6m: "cache.ret_6m",
      ret_1y: "cache.ret_1y",
      sharpe_1y: "cache.sharpe_1y",
      calmar_1y: "cache.calmar_1y",
    }
    const orderCol = allowedSort[sortKey] ?? "i.product_name"

    const filterParams: unknown[] = [EMAIL_OPS_POOL_KEY]
    const where: string[] = []

    if (emailVisibilityRegisters !== null) {
      filterParams.push(emailVisibilityRegisters)
      where.push(
        `UPPER(BTRIM(i.beian_hao)) = ANY(SELECT UPPER(BTRIM(x)) FROM unnest($${filterParams.length}::text[]) x)`,
      )
    }
    if (keyword) {
      filterParams.push(`%${keyword}%`)
      where.push(
        `(i.product_name ILIKE $${filterParams.length} OR i.beian_hao ILIKE $${filterParams.length})`,
      )
    }
    if (strategyL1) {
      filterParams.push(strategyL1)
      where.push(`${strategyL1Col} = $${filterParams.length}`)
    }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : ""
    const pLimit = filterParams.length + 1
    const pOffset = filterParams.length + 2

    const baseFrom = `
      FROM (
        SELECT DISTINCT ON (UPPER(BTRIM(p.register_number)))
          p.register_number AS beian_hao,
          p.product_name
        FROM user_custom_pool p
        WHERE p.pool_key = $1 AND p.register_number IS NOT NULL
        ORDER BY UPPER(BTRIM(p.register_number)), p.updated_at DESC NULLS LAST, p.id DESC
      ) i
      LEFT JOIN ops_tracking_funds_list_cache cache ON cache.beian_hao = i.beian_hao
    `

    const countRows = await query<{ total: string }>(
      `SELECT COUNT(*)::text AS total ${baseFrom} ${whereClause}`,
      filterParams,
    )
    const total = parseInt(countRows[0]?.total || "0", 10) || 0

    const rows = await query<{
      beian_hao: string
      product_name: string
      short_name: string | null
      strategy_l1: string | null
      strategy_l2: string | null
      team_tags: unknown
      latest_nav: string | null
      latest_nav_date: string | null
      latest_price_change: string | null
      ret_1w: string | null
      ret_1m: string | null
      ret_3m: string | null
      ret_6m: string | null
      ret_1y: string | null
      sharpe_1y: string | null
      calmar_1y: string | null
      metric_calc_time: string | null
    }>(
      `SELECT
         i.beian_hao,
         i.product_name,
         cache.short_name,
         ${strategyL1Col} AS strategy_l1,
         ${strategyL2Col} AS strategy_l2,
         cache.team_tags,
         cache.unit_nav::text AS latest_nav,
         cache.nav_date::text AS latest_nav_date,
         cache.return_pct::text AS latest_price_change,
         cache.ret_1w::text AS ret_1w,
         cache.ret_1m::text AS ret_1m,
         cache.ret_3m::text AS ret_3m,
         cache.ret_6m::text AS ret_6m,
         cache.ret_1y::text AS ret_1y,
         cache.sharpe_1y::text AS sharpe_1y,
         cache.calmar_1y::text AS calmar_1y,
         cache.refreshed_at::text AS metric_calc_time
       ${baseFrom}
       ${whereClause}
       ORDER BY ${orderCol} ${sortDir} NULLS LAST, i.product_name ASC
       LIMIT $${pLimit} OFFSET $${pOffset}`,
      [...filterParams, pageSize, (page - 1) * pageSize],
    )

    const data = rows.map((r) => {
      let teamTags: string[] | null = null
      if (Array.isArray(r.team_tags)) {
        teamTags = r.team_tags as string[]
      } else if (typeof r.team_tags === "string") {
        try {
          const parsed = JSON.parse(r.team_tags)
          teamTags = Array.isArray(parsed) ? parsed : null
        } catch {
          teamTags = null
        }
      }
      return {
        beian_hao: r.beian_hao,
        product_name: r.product_name,
        short_name: r.short_name,
        strategy_l1: r.strategy_l1,
        strategy_l2: r.strategy_l2,
        fund_company: null as string | null,
        team_tags: teamTags,
        latest_nav: r.latest_nav,
        latest_nav_date: r.latest_nav_date,
        cumulative_nav: null as string | null,
        adjusted_nav: null as string | null,
        latest_price_change: r.latest_price_change,
        holding_mv: null as string | null,
        ret_1w: r.ret_1w,
        ret_1m: r.ret_1m,
        ret_3m: r.ret_3m,
        ret_6m: r.ret_6m,
        ret_1y: r.ret_1y,
        sharpe_1y: r.sharpe_1y,
        calmar_1y: r.calmar_1y,
        metric_calc_time: r.metric_calc_time,
      }
    })

    return NextResponse.json({
      data,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "查询失败"
    return NextResponse.json(
      { error: message, data: [], total: 0, page: 1, pageSize: 50, totalPages: 1 },
      { status: 500 },
    )
  }
}
