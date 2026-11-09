import { NextResponse } from "next/server"
import { parseFactorWorkbook } from "@/lib/server/factor-workbook"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_BYTES = 20 * 1024 * 1024

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get("file")
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "请先上传一个 Excel 文件。" }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ ok: false, error: "文件超过 20MB。" }, { status: 400 })
    }
    const buffer = Buffer.from(await file.arrayBuffer())
    const parsed = parseFactorWorkbook(buffer, file.name)
    return NextResponse.json({ ok: true, ...parsed })
  } catch (error) {
    const message = error instanceof Error ? error.message : "因子文件识别失败。"
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
