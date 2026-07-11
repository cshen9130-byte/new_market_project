import { NextResponse } from "next/server"
import { lookupAmacManagerDetail } from "@/lib/server/amac-fund-metadata"
import {
  buildManagerScaleTrend,
  lookupManagerForDetail,
  managerDisplayName,
} from "@/lib/server/private-fund-manager-query"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ registration_no: string }> },
) {
  try {
    const { registration_no: rawId } = await params
    const registrationNo = decodeURIComponent(rawId).trim()
    if (!registrationNo) {
      return NextResponse.json({ error: "Missing registration_no" }, { status: 400 })
    }

    const managerHint = new URL(req.url).searchParams.get("manager")?.trim() || null
    const manager = await lookupManagerForDetail(registrationNo, managerHint)
    if (!manager) {
      return NextResponse.json({ error: "Manager not found" }, { status: 404 })
    }

    let scaleTrend: Awaited<ReturnType<typeof buildManagerScaleTrend>> = []
    try {
      scaleTrend = await buildManagerScaleTrend(manager)
    } catch (scaleErr) {
      console.error("[private-fund-managers/detail] scale trend", scaleErr)
    }

    let amacDetail = null
    try {
      amacDetail = await lookupAmacManagerDetail(registrationNo, manager.manager_name)
    } catch (amacErr) {
      console.error("[private-fund-managers/detail] amac detail", amacErr)
    }

    return NextResponse.json({
      ...manager,
      display_name: managerDisplayName(manager.manager_name),
      actual_controller: amacDetail?.actual_controller ?? null,
      full_time_employees: amacDetail?.full_time_staff_count ?? null,
      fund_qualified_employees: amacDetail?.fund_practitioner_count ?? null,
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
