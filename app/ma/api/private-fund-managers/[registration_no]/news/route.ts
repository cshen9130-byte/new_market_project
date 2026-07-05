import { NextResponse } from "next/server"
import { loadManagerNews } from "@/lib/server/private-fund-manager-news-query"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ registration_no: string }> },
) {
  try {
    const { registration_no: rawId } = await params
    const registrationNo = decodeURIComponent(rawId).trim()
    if (!registrationNo) {
      return NextResponse.json({ error: "Missing registration_no" }, { status: 400 })
    }

    const data = await loadManagerNews(registrationNo)
    if (!data) {
      return NextResponse.json({ error: "Manager not found" }, { status: 404 })
    }

    return NextResponse.json(data)
  } catch (err) {
    console.error("[private-fund-managers/news]", err)
    return NextResponse.json({ error: "Failed to load manager news" }, { status: 500 })
  }
}
