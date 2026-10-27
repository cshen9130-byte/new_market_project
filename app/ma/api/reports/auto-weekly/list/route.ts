import { NextResponse } from "next/server"
import { canAccessPfInvestmentPool } from "@/lib/permissions"
import {
  enrichAutoWeeklyListItems,
  listAutoWeeklyReports,
} from "@/lib/server/auto-weekly-reports"
import { getRequestUser } from "@/lib/server/users"
import type { User } from "@/lib/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const user = await getRequestUser(req)
  if (!canAccessPfInvestmentPool(user as User | null)) {
    return NextResponse.json({ error: "forbidden", code: "forbidden" }, { status: 403 })
  }

  const reports = await enrichAutoWeeklyListItems(listAutoWeeklyReports())
  return NextResponse.json({ data: reports, total: reports.length })
}
