import { NextResponse } from "next/server"
import {
  enrichOfficialSharedListItems,
  listOfficialSharedReports,
  type OfficialSharedSection,
} from "@/lib/server/official-shared-reports"
import { getRequestUser } from "@/lib/server/users"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SECTIONS = new Set<OfficialSharedSection>(["monthly", "quarterly", "holding"])

export async function GET(req: Request) {
  const user = await getRequestUser(req)
  if (!user?.id) {
    return NextResponse.json({ error: "请先登录", code: "unauthorized" }, { status: 401 })
  }

  const section = (new URL(req.url).searchParams.get("section") || "").trim() as OfficialSharedSection
  if (!SECTIONS.has(section)) {
    return NextResponse.json({ error: "无效的报告类型" }, { status: 400 })
  }

  const all = enrichOfficialSharedListItems(listOfficialSharedReports(section))
  const mine = all.filter((row) => row.ownerUserId === user.id)
  return NextResponse.json({ data: all, mine, team: all, total: all.length })
}
