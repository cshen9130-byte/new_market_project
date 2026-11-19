import { NextResponse } from "next/server"
import type { User } from "@/lib/auth"
import { canAccessPfInvestmentPool } from "@/lib/permissions"
import { defaultWeeklyReviewWeekEnd } from "@/lib/server/jy-weekly-review"
import { getRequestUser } from "@/lib/server/users"
import {
  buildWeeklyReviewInvestedMedian,
  type WeeklyReviewInvestedVariant,
} from "@/lib/server/weekly-review-invested-median"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

function variantOf(raw: string | null): WeeklyReviewInvestedVariant {
  return raw === "futures" ? "futures" : "equity"
}

export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams
    const weekEnd = params.get("week_end")?.trim() || defaultWeeklyReviewWeekEnd()
    const user = await getRequestUser(req)
    const canExpand = canAccessPfInvestmentPool(user as User | null)
    const body = await buildWeeklyReviewInvestedMedian(variantOf(params.get("variant")), weekEnd)
    return NextResponse.json({
      ...body,
      can_expand: canExpand,
      groups: canExpand
        ? body.groups
        : body.groups.map((group) => ({ ...group, products: [] })),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[weekly-review/invested-median]", err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
