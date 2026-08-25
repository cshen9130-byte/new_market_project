import { existsSync } from "fs"
import { readFile } from "fs/promises"
import path from "path"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const EXAMPLE_PATH = path.join(process.cwd(), "product_quarterly", "example.png")

export async function GET() {
  if (!existsSync(EXAMPLE_PATH)) {
    return NextResponse.json({ error: "范例文件不存在" }, { status: 404 })
  }

  const buffer = await readFile(EXAMPLE_PATH)
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400",
    },
  })
}
