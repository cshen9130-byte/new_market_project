import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { NextResponse } from "next/server"
import {
  INVESTMENT_NOTE_MATERIAL_MAX_BYTES,
  INVESTMENT_NOTE_MATERIAL_MAX_MB,
} from "@/lib/ma/investment-notes"
import { enqueueElementExtractForInvestmentNoteMaterial } from "@/lib/server/investment-note-element-extract"
import { getUserById } from "@/lib/server/users"
import {
  deleteInvestmentNoteMaterial,
  linkInvestmentNoteMaterial,
  listInvestmentNoteMaterialsForViewer,
  saveInvestmentNoteMaterial,
  type InvestmentNoteMaterial,
} from "@/lib/server/investment-note-materials"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 600

const CHUNK_TEMP_BASE = path.join(os.tmpdir(), "inv-note-material-chunks")

async function getUser(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  return userId ? await getUserById(userId) : null
}

async function assembleChunks(sessionId: string, totalChunks: number): Promise<Buffer> {
  const sessionDir = path.join(CHUNK_TEMP_BASE, sessionId)
  const parts: Buffer[] = []
  for (let i = 0; i < totalChunks; i++) {
    parts.push(await fs.readFile(path.join(sessionDir, `chunk_${i}`)))
  }
  await fs.rm(sessionDir, { recursive: true, force: true }).catch(() => {})
  return Buffer.concat(parts)
}

async function saveUploadedMaterial(input: {
  file: File
  userId: string
  userName: string
  noteId: string | null
}): Promise<{
  material: InvestmentNoteMaterial
  extractJob: unknown
  extractSkipReason: string | null
}> {
  const material = await saveInvestmentNoteMaterial({
    file: input.file,
    uploadedBy: input.userId,
    uploadedByName: input.userName,
    noteId: input.noteId,
  })

  let extractJob = null
  let extractSkipReason: string | null = null
  try {
    const queued = await enqueueElementExtractForInvestmentNoteMaterial({
      materialId: material.id,
      fileName: material.name,
      fileSize: material.size,
      uploadedBy: input.userName || input.userId,
    })
    extractJob = queued.job
    extractSkipReason = queued.skipReason
  } catch (err) {
    extractSkipReason = err instanceof Error ? err.message : "自动提取产品要素失败"
    console.error("[investment-notes/materials POST] element extract", err)
  }

  return { material, extractJob, extractSkipReason }
}

export async function GET(req: Request) {
  try {
    const user = await getUser(req)
    if (!user) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }
    const materials = await listInvestmentNoteMaterialsForViewer(user.id)
    return NextResponse.json({ ok: true, materials })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const user = await getUser(req)
    if (!user) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }

    let form: FormData
    try {
      form = await req.formData()
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      console.error("[investment-notes/materials POST] formData", message)
      return NextResponse.json(
        { ok: false, error: `文件过大或上传中断，请重试（单文件不超过 ${INVESTMENT_NOTE_MATERIAL_MAX_MB}MB）` },
        { status: 413 },
      )
    }
    const file = form.get("file")
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "缺少文件" }, { status: 400 })
    }
    const noteIdRaw = form.get("noteId")
    const noteId =
      typeof noteIdRaw === "string" && noteIdRaw.trim() ? noteIdRaw.trim() : null

    const chunkSessionId = String(form.get("chunkSessionId") || "").trim()
    const chunkIndexStr = form.get("chunkIndex")
    const totalChunksStr = form.get("totalChunks")
    if (chunkSessionId && chunkIndexStr !== null && totalChunksStr !== null) {
      if (!/^[0-9a-f-]{36}$/i.test(chunkSessionId)) {
        return NextResponse.json({ ok: false, error: "非法的会话 ID" }, { status: 400 })
      }
      const chunkIndex = Number.parseInt(String(chunkIndexStr), 10)
      const totalChunks = Number.parseInt(String(totalChunksStr), 10)
      if (
        !Number.isInteger(chunkIndex) ||
        !Number.isInteger(totalChunks) ||
        chunkIndex < 0 ||
        totalChunks < 1 ||
        chunkIndex >= totalChunks ||
        totalChunks > 64
      ) {
        return NextResponse.json({ ok: false, error: "分块上传参数错误" }, { status: 400 })
      }

      const originalFileSize = Number.parseInt(String(form.get("originalFileSize") || "0"), 10)
      if (Number.isFinite(originalFileSize) && originalFileSize > INVESTMENT_NOTE_MATERIAL_MAX_BYTES) {
        return NextResponse.json(
          { ok: false, error: `文件大小不能超过 ${INVESTMENT_NOTE_MATERIAL_MAX_MB}MB` },
          { status: 400 },
        )
      }

      const sessionDir = path.join(CHUNK_TEMP_BASE, chunkSessionId)
      await fs.mkdir(sessionDir, { recursive: true })
      const chunkData = Buffer.from(await file.arrayBuffer())
      await fs.writeFile(path.join(sessionDir, `chunk_${chunkIndex}`), chunkData)

      if (chunkIndex < totalChunks - 1) {
        return NextResponse.json({ ok: true, partial: true })
      }

      const assembled = await assembleChunks(chunkSessionId, totalChunks)
      if (assembled.byteLength > INVESTMENT_NOTE_MATERIAL_MAX_BYTES) {
        return NextResponse.json(
          { ok: false, error: `文件大小不能超过 ${INVESTMENT_NOTE_MATERIAL_MAX_MB}MB` },
          { status: 400 },
        )
      }
      const originalFileName = String(form.get("originalFileName") || file.name || "material.bin")
      const completeFile = new File([assembled], originalFileName, {
        type: file.type || "application/octet-stream",
      })
      const saved = await saveUploadedMaterial({
        file: completeFile,
        userId: user.id,
        userName: user.name,
        noteId,
      })
      return NextResponse.json({ ok: true, ...saved })
    }

    const saved = await saveUploadedMaterial({
      file,
      userId: user.id,
      userName: user.name,
      noteId,
    })
    return NextResponse.json({ ok: true, ...saved })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[investment-notes/materials POST]", message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const user = await getUser(req)
    if (!user) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const id = String(body?.id || "").trim()
    if (!id) {
      return NextResponse.json({ ok: false, error: "缺少资料 ID" }, { status: 400 })
    }
    const noteId =
      body?.noteId === null || body?.noteId === undefined || body?.noteId === ""
        ? null
        : String(body.noteId).trim()

    const material = linkInvestmentNoteMaterial(id, noteId, user.id)
    return NextResponse.json({ ok: true, material })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await getUser(req)
    if (!user) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const id = String(searchParams.get("id") || "").trim()
    if (!id) {
      return NextResponse.json({ ok: false, error: "缺少资料 ID" }, { status: 400 })
    }

    const ok = deleteInvestmentNoteMaterial(id, user.id)
    if (!ok) {
      return NextResponse.json({ ok: false, error: "资料不存在" }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    const status = message.includes("只能删除") ? 403 : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
