import { NextResponse } from "next/server"
import {
  fetchValuationAttachmentFromEmail,
  mimeTypeForValuationFilename,
} from "@/lib/server/email-valuation-attachment-download"
import { getEmailValuationRecordById } from "@/lib/server/email-valuation-pg"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const recordId = parseInt(id, 10)
    if (!Number.isFinite(recordId)) {
      return NextResponse.json({ error: "无效的记录 ID" }, { status: 400 })
    }

    const record = await getEmailValuationRecordById(recordId)
    if (!record) {
      return NextResponse.json({ error: "记录不存在" }, { status: 404 })
    }

    if (!record.attachment_filename?.trim()) {
      return NextResponse.json({ error: "该估值表无原始附件" }, { status: 404 })
    }

    const fetched = await fetchValuationAttachmentFromEmail({
      crawlEmailAccount: record.crawl_email_account,
      emailUid: record.email_uid,
      attachmentFilename: record.attachment_filename,
    })

    if (!fetched) {
      return NextResponse.json({ error: "无法从邮箱下载原始估值表附件" }, { status: 404 })
    }

    const filename = fetched.filename
    const encoded = encodeURIComponent(filename)

    return new NextResponse(new Uint8Array(fetched.buffer), {
      headers: {
        "Content-Type": mimeTypeForValuationFilename(filename),
        "Content-Disposition": `attachment; filename*=UTF-8''${encoded}`,
        "Content-Length": String(fetched.buffer.length),
      },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "下载失败"
    console.error("[email-valuation-records/attachment]", message, e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
