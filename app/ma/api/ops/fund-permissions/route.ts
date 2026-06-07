import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const beian_hao = (searchParams.get("beian_hao") || "").trim()
  const keyword = (searchParams.get("keyword") || "").trim()
  if (!beian_hao) return NextResponse.json({ error: "missing beian_hao" }, { status: 400 })

  try {
    const rows = await query<{
      id: number
      name: string
      share_frequency: string | null
      updated_at: string | null
    }>(
      `SELECT id, name, share_frequency, updated_at::text
       FROM ops_fund_nav_share_permissions
       WHERE beian_hao = $1
         AND ($2 = '' OR name ILIKE '%' || $2 || '%')
       ORDER BY updated_at DESC NULLS LAST, id ASC`,
      [beian_hao, keyword]
    )
    return NextResponse.json({ data: rows })
  } catch {
    return NextResponse.json({ data: [] })
  }
}
