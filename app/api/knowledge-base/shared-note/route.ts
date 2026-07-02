import { NextResponse } from "next/server"
import { promises as fs } from "fs"
import path from "path"
import { getUserById } from "@/lib/server/users"
import { getKnowledgeBaseStorageRoot, ensureKnowledgeBaseStorage } from "@/lib/server/knowledge-base"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SHARED_NOTES_FOLDER = "在线笔记"
const META_FILE = "_notes_meta.json"
const MAX_CONTENT_BYTES = 2 * 1024 * 1024 // 2 MB

export type SharedNoteMeta = {
  relativePath: string
  title: string
  createdBy: string
  createdByName: string
  createdAt: string
  updatedBy: string
  updatedByName: string
  updatedAt: string
}

async function getUser(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  return userId ? await getUserById(userId) : null
}

function sanitizeTitle(raw: string): string {
  return raw
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\.+$/, "")
    .slice(0, 100) || "笔记"
}

async function getNotesDir(): Promise<string> {
  const root = await ensureKnowledgeBaseStorage()
  const dir = path.join(root, SHARED_NOTES_FOLDER)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

async function readMeta(notesDir: string): Promise<SharedNoteMeta[]> {
  const file = path.join(notesDir, META_FILE)
  try {
    const raw = await fs.readFile(file, "utf-8")
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeMeta(notesDir: string, entries: SharedNoteMeta[]): Promise<void> {
  await fs.writeFile(path.join(notesDir, META_FILE), JSON.stringify(entries, null, 2), "utf-8")
}

/** GET ?list=1 → list  |  GET ?relativePath=xxx → content */
export async function GET(req: Request) {
  try {
    const user = await getUser(req)
    if (!user) return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })

    const { searchParams } = new URL(req.url)

    if (searchParams.get("list") === "1") {
      const notesDir = await getNotesDir()
      const meta = await readMeta(notesDir)
      meta.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      return NextResponse.json({ ok: true, notes: meta })
    }

    const relativePath = searchParams.get("relativePath") || ""
    if (!relativePath.startsWith(`${SHARED_NOTES_FOLDER}/`) || relativePath.includes("..")) {
      return NextResponse.json({ ok: false, error: "路径不合法" }, { status: 400 })
    }

    const root = getKnowledgeBaseStorageRoot()
    const filePath = path.join(root, ...relativePath.split("/"))
    const resolvedFile = path.resolve(filePath)
    const resolvedRoot = path.resolve(root)
    if (!resolvedFile.startsWith(resolvedRoot + path.sep)) {
      return NextResponse.json({ ok: false, error: "路径不合法" }, { status: 400 })
    }

    const content = await fs.readFile(filePath, "utf-8")
    return NextResponse.json({ ok: true, content })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 })
  }
}

/** PUT { title, content, relativePath? } → create or update */
export async function PUT(req: Request) {
  try {
    const user = await getUser(req)
    if (!user) return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const rawTitle = String(body?.title || "").trim()
    if (!rawTitle) return NextResponse.json({ ok: false, error: "请输入笔记标题" }, { status: 400 })

    const content = String(body?.content ?? "")
    if (Buffer.byteLength(content, "utf-8") > MAX_CONTENT_BYTES) {
      return NextResponse.json({ ok: false, error: "笔记内容过大（最大 2MB）" }, { status: 400 })
    }

    const safeTitle = sanitizeTitle(rawTitle)
    const notesDir = await getNotesDir()
    const fileName = `${safeTitle}.md`
    const filePath = path.join(notesDir, fileName)

    // Path traversal guard
    const resolvedFile = path.resolve(filePath)
    const resolvedDir = path.resolve(notesDir)
    if (!resolvedFile.startsWith(resolvedDir + path.sep) && resolvedFile !== resolvedDir) {
      return NextResponse.json({ ok: false, error: "路径不合法" }, { status: 400 })
    }

    const relativePath = `${SHARED_NOTES_FOLDER}/${fileName}`
    const now = new Date().toISOString()

    let isNew = false
    try {
      await fs.access(filePath)
    } catch {
      isNew = true
    }

    await fs.writeFile(filePath, content, "utf-8")

    const meta = await readMeta(notesDir)
    const idx = meta.findIndex((m) => m.relativePath === relativePath)
    if (idx >= 0) {
      meta[idx].title = rawTitle
      meta[idx].updatedBy = user.id
      meta[idx].updatedByName = user.name
      meta[idx].updatedAt = now
    } else {
      meta.push({
        relativePath,
        title: rawTitle,
        createdBy: user.id,
        createdByName: user.name,
        createdAt: now,
        updatedBy: user.id,
        updatedByName: user.name,
        updatedAt: now,
      })
    }
    await writeMeta(notesDir, meta)

    return NextResponse.json({ ok: true, relativePath, title: rawTitle, isNew })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 })
  }
}

/** DELETE ?relativePath=xxx */
export async function DELETE(req: Request) {
  try {
    const user = await getUser(req)
    if (!user) return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const relativePath = searchParams.get("relativePath") || ""

    if (!relativePath.startsWith(`${SHARED_NOTES_FOLDER}/`) || relativePath.includes("..")) {
      return NextResponse.json({ ok: false, error: "路径不合法" }, { status: 400 })
    }

    const notesDir = await getNotesDir()
    const meta = await readMeta(notesDir)
    const entry = meta.find((m) => m.relativePath === relativePath)

    // Only creator or admin can delete
    if (entry && entry.createdBy !== user.id && user.role !== "admin") {
      return NextResponse.json({ ok: false, error: "没有删除权限，仅创建者或管理员可删除" }, { status: 403 })
    }

    const root = getKnowledgeBaseStorageRoot()
    const filePath = path.join(root, ...relativePath.split("/"))
    const resolvedFile = path.resolve(filePath)
    const resolvedRoot = path.resolve(root)
    if (!resolvedFile.startsWith(resolvedRoot + path.sep)) {
      return NextResponse.json({ ok: false, error: "路径不合法" }, { status: 400 })
    }

    try {
      await fs.unlink(filePath)
    } catch {
      // File might already be gone
    }

    const updated = meta.filter((m) => m.relativePath !== relativePath)
    await writeMeta(notesDir, updated)

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 })
  }
}
