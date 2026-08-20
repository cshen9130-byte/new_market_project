import { NextResponse } from "next/server"
import { INVESTMENT_NOTE_MATERIAL_MAX_MB } from "@/lib/ma/investment-notes"
import { enqueueElementExtractForInvestmentNoteMaterial } from "@/lib/server/investment-note-element-extract"
import { getUserById } from "@/lib/server/users"
import {
  deleteInvestmentNoteMaterial,
  linkInvestmentNoteMaterial,
  listInvestmentNoteMaterials,
  saveInvestmentNoteMaterial,
} from "@/lib/server/investment-note-materials"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 600

async function getUser(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  return userId ? await getUserById(userId) : null
}

export async function GET(req: Request) {
  try {
    const user = await getUser(req)
    if (!user) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }
    const materials = listInvestmentNoteMaterials()
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

    const material = await saveInvestmentNoteMaterial({
      file,
      uploadedBy: user.id,
      uploadedByName: user.name,
      noteId,
    })

    let extractJob = null
    let extractSkipReason: string | null = null
    try {
      const queued = await enqueueElementExtractForInvestmentNoteMaterial({
        materialId: material.id,
        fileName: material.name,
        fileSize: material.size,
        uploadedBy: user.name || user.id,
      })
      extractJob = queued.job
      extractSkipReason = queued.skipReason
    } catch (err) {
      extractSkipReason = err instanceof Error ? err.message : "自动提取产品要素失败"
      console.error("[investment-notes/materials POST] element extract", err)
    }

    return NextResponse.json({ ok: true, material, extractJob, extractSkipReason })
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
