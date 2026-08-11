import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import { canAccessInstructionRecords } from "@/lib/server/instruction-records"
import { saveInstructionAttachment } from "@/lib/server/instruction-attachments"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getUser(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  return userId ? await getUserById(userId) : null
}

/** Upload a shared instruction 合同 / 确认函 attachment. */
export async function POST(req: Request) {
  try {
    const user = await getUser(req)
    if (!user || !canAccessInstructionRecords(user)) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }

    const form = await req.formData()
    const file = form.get("file")
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "缺少文件" }, { status: 400 })
    }
    const requestedId = String(form.get("id") || "").trim() || undefined
    const meta = await saveInstructionAttachment({
      file,
      uploadedBy: user.id,
      id: requestedId,
    })
    return NextResponse.json({ ok: true, attachment: meta })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[instructions/attachments POST]", message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
