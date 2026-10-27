import { NextResponse } from "next/server"
import { enrichMineWeeklyListItems } from "@/lib/server/auto-weekly-mine-reports"
import { getRequestUser } from "@/lib/server/users"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const user = await getRequestUser(req)
  if (!user?.id) {
    return NextResponse.json({ error: "请先登录", code: "unauthorized" }, { status: 401 })
  }

  const reports = await enrichMineWeeklyListItems(user.id)
  return NextResponse.json({ data: reports, total: reports.length })
}
