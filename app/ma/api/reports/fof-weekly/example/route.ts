import { existsSync } from "fs"
import { readFile } from "fs/promises"
import path from "path"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const EXAMPLE_PATH = path.join(
  process.cwd(),
  "haitai_week_report",
  "低波稳健FOF 1号周报_20260626.png",
)

export async function GET() {
  if (!existsSync(EXAMPLE_PATH)) {
    return NextResponse.json({ error: "范例文件不存在" }, { status: 404 })
  }

  const buffer = await readFile(EXAMPLE_PATH)
  return new Response(buffer, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400",
    },
  })
}
