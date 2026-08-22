/**
 * account-risk/product-elements
 * Per-account 产品要素 from settlement client_name + fund element tables.
 * Missing fields stay empty — never reuse another account's edited draft.
 */
import { NextResponse } from "next/server"
import { withCfmmcAccount } from "@/lib/server/account-risk-scope"
import { loadAccountRiskProductElements } from "@/lib/server/account-risk-product-elements"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = withCfmmcAccount(async function GET() {
  try {
    const elements = await loadAccountRiskProductElements()
    return NextResponse.json({ ok: true, ...elements })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "查询失败" },
      { status: 500 },
    )
  }
})
