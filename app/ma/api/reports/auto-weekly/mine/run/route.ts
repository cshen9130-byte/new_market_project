import { NextResponse } from "next/server"
import { runMineWeeklyReportsEtl } from "@/lib/server/auto-weekly-mine-reports"
import { getRequestUser } from "@/lib/server/users"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

/** Generate / refresh weekly reports for the current user's tracked products. */
export async function POST(req: Request) {
  const user = await getRequestUser(req)
  if (!user?.id) {
    return NextResponse.json({ error: "请先登录", code: "unauthorized" }, { status: 401 })
  }

  let body: { productNames?: string[] } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    body = {}
  }

  const creator = user.name || user.email || "我"
  const result = await runMineWeeklyReportsEtl(user.id, creator, {
    productNames: Array.isArray(body.productNames) ? body.productNames : undefined,
  })

  return NextResponse.json({ ok: result.ok, result })
}
