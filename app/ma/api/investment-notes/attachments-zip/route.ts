import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import { zipInvestmentNoteAttachmentFiles } from "@/lib/server/investment-note-materials"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

const MAX_IDS = 80

async function getUser(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  return userId ? await getUserById(userId) : null
}

function safeZipFilename(name: string): string {
  const cleaned =
    name.replace(/[/\\?%*:|"<>]/g, "_").replace(/\s+/g, " ").trim() || "附件"
  return cleaned.toLowerCase().endsWith(".zip") ? cleaned : `${cleaned}.zip`
}

function encodeFileName(fileName: string) {
  return encodeURIComponent(fileName).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16)}`)
}

export async function POST(req: Request) {
  try {
    const user = await getUser(req)
    if (!user) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as {
      ids?: unknown
      filename?: unknown
    }
    const ids = Array.isArray(body.ids)
      ? body.ids.map((id) => String(id || "").trim()).filter(Boolean)
      : []
    if (ids.length === 0) {
      return NextResponse.json({ ok: false, error: "没有可打包的附件" }, { status: 400 })
    }
    if (ids.length > MAX_IDS) {
      return NextResponse.json({ ok: false, error: `一次最多打包 ${MAX_IDS} 个附件` }, { status: 400 })
    }

    const { buffer } = await zipInvestmentNoteAttachmentFiles(ids)
    const filename = safeZipFilename(typeof body.filename === "string" ? body.filename : "附件")
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeFileName(filename)}`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    const status = message.includes("没有可下载") ? 400 : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
