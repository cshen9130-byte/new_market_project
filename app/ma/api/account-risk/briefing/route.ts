import { NextResponse } from "next/server"
import { getAccountBriefingFile } from "@/lib/server/account-briefing-file"
import { getCfmmcAccount, getCfmmcBook, withCfmmcAccount } from "@/lib/server/account-risk-scope"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = withCfmmcAccount(async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const result = await getAccountBriefingFile({
    date: searchParams.get("date") ?? undefined,
    account: getCfmmcAccount() ?? searchParams.get("account") ?? undefined,
    book: getCfmmcBook() ?? searchParams.get("book") ?? undefined,
    productName: searchParams.get("productName") ?? undefined,
  })
  if (!result.ok) {
    return NextResponse.json(result, { status: result.error?.includes("没有") ? 404 : 500 })
  }
  return NextResponse.json(result)
})
