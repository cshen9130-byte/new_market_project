import { NextResponse } from "next/server"
import { getFofReturnAttribution } from "@/lib/server/fof-return-attribution"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ beian_hao: string }> },
) {
  try {
    const { beian_hao } = await params
    const code = decodeURIComponent(beian_hao || "").trim()
    if (!code) {
      return NextResponse.json({ error: "beian_hao required" }, { status: 400 })
    }
    const url = new URL(req.url)
    const from = (url.searchParams.get("from") ?? "").slice(0, 10)
    const to = (url.searchParams.get("to") ?? "").slice(0, 10)
    if (!from || !to) {
      return NextResponse.json({ error: "from and to required" }, { status: 400 })
    }
    const data = await getFofReturnAttribution(code, from, to)
    return NextResponse.json(data)
  } catch (err) {
    console.error("[private-funds/valuation/fof-attribution]", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown error" },
      { status: 500 },
    )
  }
}
