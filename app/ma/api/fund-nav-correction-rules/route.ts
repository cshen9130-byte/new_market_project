import { NextResponse } from "next/server"
import {
  getFundNavCorrectionRule,
  listFundNavCorrectionRules,
} from "@/lib/server/fund-nav-correction-rules"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const code = url.searchParams.get("code")?.trim().toUpperCase()
    if (code) {
      const rule = getFundNavCorrectionRule(code)
      return NextResponse.json({ rule })
    }
    return NextResponse.json({ rules: listFundNavCorrectionRules() })
  } catch (err) {
    console.error("[fund-nav-correction-rules GET]", err)
    return NextResponse.json({ error: "加载净值修正规则失败" }, { status: 500 })
  }
}
