import { NextResponse } from "next/server"
import { canAccessPfInvestmentPool } from "@/lib/permissions"
import { accountCanUseMom } from "@/lib/ma/account-dashboard"
import {
  enrichAutoWeeklyListItems,
  listAutoWeeklyReportsForDisplay,
} from "@/lib/server/auto-weekly-reports"
import { readAccountDashboard } from "@/lib/server/account-dashboard-store"
import { getRequestUser } from "@/lib/server/users"
import type { User } from "@/lib/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const user = await getRequestUser(req)
  if (!user || !canAccessPfInvestmentPool(user as User | null)) {
    return NextResponse.json({ error: "forbidden", code: "forbidden" }, { status: 403 })
  }

  const prefs = await readAccountDashboard(user.id, accountCanUseMom(user), user)
  const reports = await enrichAutoWeeklyListItems(
    listAutoWeeklyReportsForDisplay(prefs.weeklyReportTemplate),
  )
  return NextResponse.json({
    data: reports,
    total: reports.length,
    weeklyReportTemplate: prefs.weeklyReportTemplate,
  })
}
