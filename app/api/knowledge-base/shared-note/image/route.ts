import { NextResponse } from "next/server"
import path from "path"
import { getUserById } from "@/lib/server/users"
import { ensureKnowledgeBaseStorage, saveKnowledgeBaseFile, normalizeKnowledgeBasePath } from "@/lib/server/knowledge-base"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SHARED_NOTES_FOLDER = "在线笔记"
const IMAGES_FOLDER = "_images"
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
])

async function getUser(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  return userId ? await getUserById(userId) : null
}

function sanitizeNoteKey(raw: string): string {
  return raw
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\.+$/, "")
    .slice(0, 80) || "draft"
}

function buildImageFileName(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase()
  const safeExt = [".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext) ? ext : ".png"
  const stamp = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `${stamp}-${rand}${safeExt}`
}

function buildMarkdownImage(relativePath: string, alt: string): string {
  const params = new URLSearchParams({ path: relativePath })
  return `![${alt}](/api/knowledge-base/file?${params.toString()})`
}

export async function POST(req: Request) {
  try {
    const user = await getUser(req)
    if (!user) return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })

    const form = await req.formData()
    const file = form.get("file")
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "请选择图片文件" }, { status: 400 })
    }

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return NextResponse.json({ ok: false, error: "仅支持 PNG、JPEG、GIF、WebP 图片" }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      return NextResponse.json({ ok: false, error: "图片过大（最大 5MB）" }, { status: 400 })
    }

    const noteTitle = String(form.get("noteTitle") || "").trim()
    const noteRelativePath = String(form.get("relativePath") || "").trim()
    let noteKey = sanitizeNoteKey(noteTitle)
    if (!noteTitle && noteRelativePath.startsWith(`${SHARED_NOTES_FOLDER}/`)) {
      const baseName = path.basename(noteRelativePath, path.extname(noteRelativePath))
      noteKey = sanitizeNoteKey(baseName)
    }

    const imageFolder = normalizeKnowledgeBasePath(`${SHARED_NOTES_FOLDER}/${IMAGES_FOLDER}/${noteKey}`)
    const imageName = buildImageFileName(file.name || "image.png")
    const uploadFile = new File([buffer], imageName, { type: file.type || "image/png" })

    await ensureKnowledgeBaseStorage()
    const saved = await saveKnowledgeBaseFile(imageFolder, uploadFile, {
      ownerId: user.id,
      ownerName: user.name,
      ownerEmail: user.email,
    })

    const alt = path.basename(file.name || "image", path.extname(file.name || "")) || "image"
    const markdown = buildMarkdownImage(saved.relativePath, alt)

    return NextResponse.json({
      ok: true,
      relativePath: saved.relativePath,
      markdown,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 })
  }
}
