import { NextResponse } from "next/server"
import { listCrawlEmails, syncCrawlEmailsFromConfiguredAccounts } from "@/lib/server/crawl-emails"
import { readSenders } from "@/lib/server/email-dispatch"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST() {
  try {
    const senders = readSenders()
    const changed = await syncCrawlEmailsFromConfiguredAccounts()
    const total = listCrawlEmails().length

    if (senders.length === 0) {
      return NextResponse.json({
        imported: changed,
        total,
        message: changed > 0
          ? "已同步已知邮箱；发件账号列表为空，授权码需手动填写或稍后在「自动发邮件」配置后再次导入。"
          : "发件账号列表为空。已知邮箱已在列表中，授权码请手动填写或稍后在「自动发邮件」配置后再次导入。",
      })
    }

    if (changed === 0) {
      return NextResponse.json({
        imported: 0,
        total,
        message: "所有发件账号已同步，无需重复导入。",
      })
    }

    return NextResponse.json({
      imported: changed,
      total,
      message: `已成功同步 ${changed} 个邮箱账号。`,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "导入失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
