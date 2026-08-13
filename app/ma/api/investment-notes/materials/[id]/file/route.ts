import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import { readInvestmentNoteMaterialFile } from "@/lib/server/investment-note-materials"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getUser(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  return userId ? await getUserById(userId) : null
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getUser(req)
    if (!user) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }

    const { id } = await context.params
    const file = await readInvestmentNoteMaterialFile(id)
    if (!file) {
      return NextResponse.json({ ok: false, error: "文件不存在" }, { status: 404 })
    }

    const encoded = encodeURIComponent(file.filename)
    return new NextResponse(new Uint8Array(file.buffer), {
      status: 200,
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `inline; filename*=UTF-8''${encoded}`,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
