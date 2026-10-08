import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import { generateInvestmentNoteFromMaterials } from "@/lib/server/investment-note-generate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

async function getUser(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  return userId ? await getUserById(userId) : null
}

export async function POST(req: Request) {
  try {
    const user = await getUser(req)
    if (!user) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const materialIds = Array.isArray(body?.materialIds)
      ? body.materialIds.map((id: unknown) => String(id || "").trim()).filter(Boolean)
      : []

    if (materialIds.length === 0) {
      return NextResponse.json({ ok: false, error: "请先选择文件" }, { status: 400 })
    }

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (payload: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(JSON.stringify(payload) + "\n"))
        }
        // proxy_read_timeout is 300s of silence. Text extraction and the model
        // call emit nothing until they finish, so a company PDF was dropped as
        // a browser failure while the status sat on「正在生成笔记内容」.
        const keepAlive = setInterval(() => {
          try {
            controller.enqueue(encoder.encode("\n"))
          } catch {
            clearInterval(keepAlive)
          }
        }, 12_000)
        try {
          const result = await generateInvestmentNoteFromMaterials({
            materialIds,
            userId: user.id,
            userName: user.name,
            owner: { id: user.id, name: user.name, email: user.email },
            onProgress: (progress) => send({ type: "progress", ...progress }),
          })
          send({
            type: "done",
            ok: true,
            note: result.note,
            materials: result.materials,
            skipped: result.skipped,
          })
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e)
          console.error("[investment-notes/generate-from-materials]", e)
          try {
            send({ type: "error", ok: false, error: message })
          } catch {
            // Client already disconnected.
          }
        } finally {
          clearInterval(keepAlive)
          try {
            controller.close()
          } catch {
            // already closed
          }
        }
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[investment-notes/generate-from-materials]", e)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
