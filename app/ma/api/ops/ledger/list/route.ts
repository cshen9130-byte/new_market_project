import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import {
  canAccessOpsLedger,
  filterOpsLedgerRecords,
  listServerOpsLedgerRecords,
} from "@/lib/server/ops-ledger-records"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getUser(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  return userId ? await getUserById(userId) : null
}

/** Shared FOF ledger list. */
export async function GET(req: Request) {
  try {
    const user = await getUser(req)
    if (!user || !canAccessOpsLedger(user)) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1)
    const pageSize = Math.min(
      200,
      Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10) || 50),
    )
    const sortRaw = searchParams.get("sort") || "apply_date"
    const sort =
      sortRaw === "confirm_date" || sortRaw === "apply_date" ? sortRaw : "apply_date"
    const dir = searchParams.get("dir") === "asc" ? "asc" : "desc"

    // all=1 returns the full shared inbox (client hydrate); otherwise paginated filters.
    if (searchParams.get("all") === "1") {
      const records = await listServerOpsLedgerRecords()
      return NextResponse.json({ ok: true, records })
    }

    const all = await listServerOpsLedgerRecords()
    const result = filterOpsLedgerRecords(all, {
      page,
      pageSize,
      fof_register_number: searchParams.get("fof_register_number"),
      fof_fund_name: searchParams.get("fof_fund_name"),
      underlying_beian_hao: searchParams.get("underlying_beian_hao"),
      apply_date_from: searchParams.get("apply_date_from") || undefined,
      apply_date_to: searchParams.get("apply_date_to") || undefined,
      sort,
      dir,
    })

    return NextResponse.json({
      ok: true,
      data: result.data,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[ops/ledger/list]", message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
