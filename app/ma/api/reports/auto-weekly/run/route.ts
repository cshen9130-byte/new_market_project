import { NextResponse } from "next/server"
import { isAdmin } from "@/lib/permissions"
import {
  getAutoWeeklyReportsEtlJobStatus,
  startAutoWeeklyReportsEtlJob,
} from "@/lib/server/auto-weekly-reports-etl-job"
import { getRequestUser } from "@/lib/server/users"
import type { User } from "@/lib/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

/**
 * Manual trigger for local verify / admin catch-up.
 * POST body optional: { force?: boolean, limit?: number, productNames?: string[] }
 * Always requires admin. Pass force=true on Windows tunnel to actually run.
 */
export async function POST(req: Request) {
  const user = await getRequestUser(req)
  if (!isAdmin(user as User | null)) {
    return NextResponse.json({ error: "仅管理员可手动触发" }, { status: 403 })
  }

  let body: { force?: boolean; limit?: number; productNames?: string[] } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    body = {}
  }

  const started = startAutoWeeklyReportsEtlJob({
    force: body.force === true,
    limit: typeof body.limit === "number" ? body.limit : undefined,
    productNames: Array.isArray(body.productNames) ? body.productNames : undefined,
  })

  if (!started.ok) {
    return NextResponse.json(
      { ok: false, reason: started.reason, status: getAutoWeeklyReportsEtlJobStatus() },
      { status: 409 },
    )
  }

  return NextResponse.json({
    ok: true,
    status: getAutoWeeklyReportsEtlJobStatus(),
    statusUrl: "/ma/api/reports/auto-weekly/run",
  })
}

export async function GET(req: Request) {
  const user = await getRequestUser(req)
  if (!isAdmin(user as User | null)) {
    return NextResponse.json({ error: "仅管理员可查询" }, { status: 403 })
  }
  return NextResponse.json({ status: getAutoWeeklyReportsEtlJobStatus() })
}
