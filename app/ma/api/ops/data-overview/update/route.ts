import { NextResponse } from "next/server"
import { getUpdateChannel, parseUpdateChannel } from "@/lib/server/ops-update-channel"

export const runtime = "nodejs"

export const dynamic = "force-dynamic"

export const maxDuration = 120

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const channel = parseUpdateChannel(searchParams.get("channel"))
    if (!channel) {
      return NextResponse.json({ error: "bad_channel", message: "请选择 fof99 或邮箱" }, { status: 400 })
    }
    const refresh = searchParams.get("refresh") === "1"
    const body = await getUpdateChannel(channel, refresh)
    return NextResponse.json(body)
  } catch (err) {
    console.error("[ops/data-overview/update]", err)
    const timedOut = err instanceof Error && /timeout|canceling statement/i.test(err.message)
    return NextResponse.json(
      {
        error: "update_channel_failed",
        message: timedOut ? "统计超时，请稍后重试" : "更新渠道加载失败，请稍后重试",
      },
      { status: 500 },
    )
  }
}
