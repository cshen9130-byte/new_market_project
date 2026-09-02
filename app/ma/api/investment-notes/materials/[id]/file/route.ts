import path from "path"
import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import {
  previewInvestmentNoteMaterialFile,
  readInvestmentNoteMaterialFile,
} from "@/lib/server/investment-note-materials"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const POWERPOINT_DOWNLOAD_EXTENSIONS = new Set([
  ".ppt",
  ".pptx",
  ".pptm",
  ".pps",
  ".ppsx",
  ".ppsm",
  ".pot",
  ".potx",
  ".potm",
])

async function getUser(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  return userId ? await getUserById(userId) : null
}

function encodeFileName(fileName: string) {
  return encodeURIComponent(fileName).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16)}`)
}

function contentTypeHeader(mimeType: string): string {
  const base = (mimeType || "").split(";")[0].trim() || "application/octet-stream"
  if (base.startsWith("text/") || base === "application/json" || base.includes("html")) {
    return mimeType.includes("charset") ? mimeType : `${base}; charset=utf-8`
  }
  return base
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
    const { searchParams } = new URL(req.url)
    const wantPreview = searchParams.get("preview") === "1"
    const wantDownload = searchParams.get("download") === "1"

    if (wantPreview && !wantDownload) {
      const preview = await previewInvestmentNoteMaterialFile(id)
      if (preview?.content) {
        return new NextResponse(preview.content, {
          status: 200,
          headers: {
            "Content-Type": preview.contentType || "text/html; charset=utf-8",
            "Content-Disposition": `inline; filename*=UTF-8''${encodeFileName("preview.html")}`,
            "Cache-Control": "private, max-age=0, must-revalidate",
          },
        })
      }
    }

    const file = await readInvestmentNoteMaterialFile(id)
    if (!file) {
      return NextResponse.json({ ok: false, error: "文件不存在" }, { status: 404 })
    }

    const ext = path.extname(file.filename || "").toLowerCase()
    const disposition =
      wantDownload || POWERPOINT_DOWNLOAD_EXTENSIONS.has(ext) ? "attachment" : "inline"
    return new NextResponse(new Uint8Array(file.buffer), {
      status: 200,
      headers: {
        "Content-Type": contentTypeHeader(file.mimeType),
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeFileName(file.filename)}`,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
