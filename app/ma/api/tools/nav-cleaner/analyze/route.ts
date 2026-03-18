import { NextResponse } from "next/server"

import { analyzeNavWorkbook } from "@/lib/server/nav-cleaner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get("file")

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请先上传一个净值文件。" }, { status: 400 })
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer())
    const analysis = analyzeNavWorkbook(fileBuffer, file.name)
    return NextResponse.json(analysis)
  } catch (error) {
    const message = error instanceof Error ? error.message : "净值文件识别失败。"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}