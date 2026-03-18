import { NextResponse } from "next/server"

import { buildTemplateWorkbook, type NavCleanerRow } from "@/lib/server/nav-cleaner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type DownloadPayload = {
  rows?: NavCleanerRow[]
  sourceFileName?: string
}

function sanitizeBaseName(fileName: string | undefined) {
  const resolved = (fileName || "nav_cleaned")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
  return resolved || "nav_cleaned"
}

function isValidRow(row: NavCleanerRow | undefined): row is NavCleanerRow {
  return !!row && typeof row.date === "string" && Number.isFinite(row.unitNav) && Number.isFinite(row.cumulativeNav)
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as DownloadPayload
    const rows = (payload.rows ?? []).filter(isValidRow)
    if (rows.length === 0) {
      return NextResponse.json({ error: "没有可下载的数据。" }, { status: 400 })
    }

    const workbookBuffer = buildTemplateWorkbook(rows)
    const fileName = `${sanitizeBaseName(payload.sourceFileName)}_template.xlsx`

    return new NextResponse(workbookBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "导出净值模板失败。"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}