import { NextResponse } from "next/server"
import * as XLSX from "xlsx"
import {
  fetchValuationAttachmentFromEmail,
  mimeTypeForValuationFilename,
} from "@/lib/server/email-valuation-attachment-download"
import { getEmailValuationRecordById, type EmailValuationRecordRow } from "@/lib/server/email-valuation-pg"
import { listValuationHoldingsByRecordId } from "@/lib/server/email-valuation-holdings-pg"
import { parseZipInnerAttachmentKey } from "@/lib/server/email-valuation-zip"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const IMAP_EXPORT_TIMEOUT_MS = 25_000

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

function fileResponse(buffer: Buffer, filename: string) {
  const encoded = encodeURIComponent(filename)
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": mimeTypeForValuationFilename(filename),
      "Content-Disposition": `attachment; filename*=UTF-8''${encoded}`,
      "Content-Length": String(buffer.length),
    },
  })
}

function reconstructedFilename(record: EmailValuationRecordRow): string {
  const date = String(record.valuation_date ?? "").slice(0, 10)
  const inner = parseZipInnerAttachmentKey(record.attachment_filename ?? "")
  const raw = (inner?.inner || record.attachment_filename || `${record.fund_name || "估值表"}_${date}`).trim()
  const safe = raw.replace(/[\\/:*?"<>|]+/g, "_") || `valuation_${record.id}`
  if (/\.xlsx?$/i.test(safe)) return safe.replace(/\.xls$/i, ".xlsx")
  return `${safe}.xlsx`
}

function buildWorkbookFromRows(aoa: unknown[][]): Buffer | null {
  if (aoa.length === 0) return null
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(aoa), "估值表")
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer)
}

function buildStoredValuationWorkbook(record: EmailValuationRecordRow): Buffer | null {
  const holdings = Array.isArray(record.holdings) ? record.holdings : []
  const headerRows = Array.isArray(record.summary?.header_rows) ? record.summary.header_rows : []
  const aoa: unknown[][] = []

  if (headerRows.length > 0) {
    for (const row of headerRows) {
      aoa.push(Array.isArray(row) ? row : [row])
    }
    if (holdings.length > 0) aoa.push([])
  } else {
    aoa.push(["基金名称", record.fund_name ?? ""])
    aoa.push(["估值日期", String(record.valuation_date ?? "").slice(0, 10)])
    aoa.push(["单位净值", record.unit_nav ?? ""])
    aoa.push(["累计净值", record.cumulative_nav ?? ""])
    aoa.push(["净资产", record.net_asset ?? ""])
    aoa.push([])
  }

  if (holdings.length > 0) {
    const keys: string[] = []
    const seen = new Set<string>()
    for (const row of holdings) {
      for (const key of Object.keys(row ?? {})) {
        if (seen.has(key)) continue
        seen.add(key)
        keys.push(key)
      }
    }
    if (keys.length > 0) {
      aoa.push(keys)
      for (const row of holdings) {
        aoa.push(keys.map((key) => row?.[key] ?? ""))
      }
    }
  }

  return holdings.length > 0 || headerRows.length > 0 ? buildWorkbookFromRows(aoa) : null
}

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

    let reconstructed = buildStoredValuationWorkbook(record)
    if (!reconstructed?.length) {
      const normalized = await listValuationHoldingsByRecordId(recordId, { detailOnly: false })
      if (normalized.length > 0) {
        const aoa: unknown[][] = [
          ["基金名称", record.fund_name ?? ""],
          ["估值日期", String(record.valuation_date ?? "").slice(0, 10)],
          ["单位净值", record.unit_nav ?? ""],
          ["累计净值", record.cumulative_nav ?? ""],
          ["净资产", record.net_asset ?? ""],
          [],
          ["科目代码", "科目名称", "数量", "成本", "市值", "市值占比"],
          ...normalized.map((row) => [
            row.originalSubjectCode || row.subjectCode,
            row.subjectName,
            row.quantity,
            row.cost,
            row.marketValue,
            row.marketWeight,
          ]),
        ]
        reconstructed = buildWorkbookFromRows(aoa)
      }
    }
    if (reconstructed?.length) {
      return fileResponse(reconstructed, reconstructedFilename(record))
    }

    if (record.attachment_filename?.trim() && record.email_uid?.trim() && record.crawl_email_account?.trim()) {
      try {
        const fetched = await withTimeout(
          fetchValuationAttachmentFromEmail({
            crawlEmailAccount: record.crawl_email_account,
            emailUid: record.email_uid,
            attachmentFilename: record.attachment_filename,
          }),
          IMAP_EXPORT_TIMEOUT_MS,
          "从邮箱下载超时",
        )
        if (fetched?.buffer?.length) {
          return fileResponse(fetched.buffer, fetched.filename)
        }
      } catch (e) {
        console.warn(
          "[email-valuation-records/attachment] IMAP export failed:",
          e instanceof Error ? e.message : e,
        )
      }
    }

    return NextResponse.json(
      { error: "无法导出该估值表：邮箱附件不可用，且没有已解析的持仓数据" },
      { status: 404 },
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : "下载失败"
    console.error("[email-valuation-records/attachment]", message, e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
