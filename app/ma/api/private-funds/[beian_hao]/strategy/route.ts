import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { resolveRouteFundId } from "@/lib/server/fof-underlying-query"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ beian_hao: string }> }
) {
  const { beian_hao: rawId } = await params
  const beian_hao = await resolveRouteFundId(rawId)
  if (!beian_hao) return NextResponse.json({ error: "Missing beian_hao" }, { status: 400 })

  const body = await req.json()
  const strategy_l1: string | null = body.strategy_l1 ?? null
  const strategy_l2: string | null = body.strategy_l2 ?? null
  const strategy_l3: string | null = body.strategy_l3 ?? null

  try {
    const result = await query<{ register_number: string }>(
      `UPDATE type6_ops_team_full
       SET company_strategy_one   = $2,
           company_strategy_two   = $3,
           company_strategy_three = $4
       WHERE register_number = $1
       RETURNING register_number`,
      [beian_hao, strategy_l1, strategy_l2, strategy_l3]
    )

    if (!result.length) {
      return NextResponse.json({ error: "Fund not found in team pool" }, { status: 404 })
    }

    return NextResponse.json({ ok: true, updated: result.length })
  } catch (err) {
    console.error("Strategy PATCH error:", err)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}
