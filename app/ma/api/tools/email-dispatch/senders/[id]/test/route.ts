import { NextResponse } from "next/server"
import { testSenderConnection } from "@/lib/server/email-dispatch"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await testSenderConnection(id)
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "连接测试失败。"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
