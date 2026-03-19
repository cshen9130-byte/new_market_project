import { NextResponse } from "next/server"
import * as XLSX from "xlsx"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_ROWS = 10_000

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get("file")

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请先上传一个文件。" }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true })

    const sheetName = workbook.SheetNames[0]
    if (!sheetName) {
      return NextResponse.json({ error: "文件中未找到工作表。" }, { status: 422 })
    }

    const sheet = workbook.Sheets[sheetName]
    // Convert to array-of-objects, with header row as keys
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
      raw: false,
      dateNF: "yyyy-mm-dd",
    })

    const warnings: string[] = []
    if (rawRows.length === 0) {
      warnings.push("工作表中未检测到数据行。")
    }
    if (rawRows.length > MAX_ROWS) {
      warnings.push(`数据行数超过 ${MAX_ROWS}，已截断显示。`)
    }

    const rows = rawRows.slice(0, MAX_ROWS) as Record<string, string | number>[]
    const columns = rows.length > 0 ? Object.keys(rows[0]) : []

    return NextResponse.json({
      fileName: file.name,
      sheetName,
      columns,
      rowCount: rawRows.length,
      rows,
      warnings,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "文件解析失败。"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
