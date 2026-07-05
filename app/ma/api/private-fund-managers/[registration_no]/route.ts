import { NextResponse } from "next/server"
import {
  buildManagerScaleTrend,
  lookupManagerByRegistrationNo,
  managerDisplayName,
} from "@/lib/server/private-fund-manager-query"

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

    const manager = await lookupManagerByRegistrationNo(registrationNo)
    if (!manager) {
      return NextResponse.json({ error: "Manager not found" }, { status: 404 })
    }

    const scaleTrend = await buildManagerScaleTrend(manager)

    return NextResponse.json({
      ...manager,
      display_name: managerDisplayName(manager.manager_name),
      actual_controller: null,
      full_time_employees: null,
      fund_qualified_employees: null,
      company_intro: null,
      investment_philosophy: null,
      investment_strategy: null,
      scale_trend: scaleTrend,
    })
  } catch (err) {
    console.error("[private-fund-managers/detail]", err)
    return NextResponse.json({ error: "Failed to load manager detail" }, { status: 500 })
  }
}
