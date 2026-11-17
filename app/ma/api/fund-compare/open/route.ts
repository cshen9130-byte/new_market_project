import { NextResponse } from "next/server"
import { loadFundCompareLink } from "@/lib/server/fund-compare-link"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Open a compare group created by the fund data API. The id is unguessable enough for a shared page link. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id")?.trim() || ""
  const compare = await loadFundCompareLink(id)
  if (!compare) return NextResponse.json({ error: "未找到该对比组" }, { status: 404 })
  return NextResponse.json({ compare })
}
