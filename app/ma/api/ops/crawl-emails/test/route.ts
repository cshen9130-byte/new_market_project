import { NextResponse } from "next/server"
import { getCrawlEmailById, testImapConnection } from "@/lib/server/crawl-emails"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { account, pass, imapHost, imapPort, id } = body as Record<string, unknown>

    let resolvedAccount = typeof account === "string" ? account.trim() : ""
    let resolvedPass = typeof pass === "string" ? pass.trim() : ""
    const resolvedHost = typeof imapHost === "string" ? imapHost.trim() : ""
    const resolvedPort = Number(imapPort || 993)

    if (!resolvedPass && typeof id === "string" && id) {
      const existing = getCrawlEmailById(id)
      if (!existing) return NextResponse.json({ error: "记录不存在" }, { status: 404 })
      if (!resolvedAccount) resolvedAccount = existing.account
      resolvedPass = existing.pass
    }

    await testImapConnection(resolvedAccount, resolvedPass, resolvedHost, resolvedPort)
    return NextResponse.json({ success: true, message: "连接成功" })
  } catch (e) {
    const message = e instanceof Error ? e.message : "连接失败"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
