import { NextResponse } from "next/server"
import type { FundNavCorrectionRule } from "@/lib/fund-nav-correction-rules-types"
import {
  deleteFundNavCorrectionRule,
  saveFundNavCorrectionRule,
} from "@/lib/server/fund-nav-correction-rules"
import { upsertTrackingFundListCacheEntry } from "@/lib/server/tracking-funds-list-cache-pg"

export const dynamic = "force-dynamic"

type SaveBody = {
  rule?: Partial<FundNavCorrectionRule>
  delete?: boolean
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as SaveBody
    const beian = (body.rule?.beian_hao ?? "").trim().toUpperCase()
    if (!beian) {
      return NextResponse.json({ error: "备案号不能为空" }, { status: 400 })
    }

    if (body.delete) {
      deleteFundNavCorrectionRule(beian)
      try {
        await upsertTrackingFundListCacheEntry(beian, body.rule?.product_names?.[0] ?? beian)
      } catch {
        // cache refresh is best-effort
      }
      return NextResponse.json({ ok: true, deleted: true })
    }

    const saved = saveFundNavCorrectionRule({
      beian_hao: beian,
      product_names: body.rule?.product_names ?? [],
      series_start_date: body.rule?.series_start_date ?? "",
      preserve_high_nav_scale: body.rule?.preserve_high_nav_scale === true,
      note: body.rule?.note ?? "",
    })

    try {
      await upsertTrackingFundListCacheEntry(beian, body.rule?.product_names?.[0] ?? beian)
    } catch {
      // cache refresh is best-effort
    }

    return NextResponse.json({ ok: true, rule: saved })
  } catch (err) {
    const message = err instanceof Error ? err.message : "保存失败"
    console.error("[fund-nav-correction-rules save]", err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
