import { NextResponse } from "next/server"

import { parseValuationWorkbook } from "@/lib/server/valuation-analyzer"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get("file")

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请先上传一个估值文件。" }, { status: 400 })
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer())
    const result = parseValuationWorkbook(fileBuffer, file.name)
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "估值文件解析失败。"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
