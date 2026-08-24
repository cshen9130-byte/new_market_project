import { NextResponse } from "next/server"
import { importConfiguredEmails, listCrawlEmails } from "@/lib/server/crawl-emails"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const accounts = Array.isArray((body as { accounts?: unknown }).accounts)
      ? (body as { accounts: unknown[] }).accounts.filter((a): a is string => typeof a === "string")
      : []

    if (accounts.length === 0) {
      return NextResponse.json({ error: "请选择要导入的邮箱" }, { status: 400 })
    }

    const imported = await importConfiguredEmails(accounts)
    const total = (await listCrawlEmails()).length

    if (imported === 0) {
      return NextResponse.json({
        imported: 0,
        total,
        message: "所选邮箱已在列表中或无法导入。",
      })
    }

    return NextResponse.json({
      imported,
      total,
      message: `已成功导入 ${imported} 个邮箱。`,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "导入失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
