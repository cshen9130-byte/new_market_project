import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import {
  listDirectEmailVisibilityRows,
  requireAdminUser,
  saveDirectEmailVisibilityMappings,
} from "@/lib/server/direct-email-visibility"
import { invalidateListResponseCache } from "@/lib/server/list-response-cache"
import { EMAIL_OPS_POOL_KEY } from "@/lib/server/email-tracking-pool-sync"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const auth = await requireAdminUser(req)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    return NextResponse.json({ data: listDirectEmailVisibilityRows() })
  } catch (e) {
    const message = e instanceof Error ? e.message : "读取失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const auth = await requireAdminUser(req)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const body = await req.json().catch(() => null)
    const items = Array.isArray((body as { mappings?: unknown })?.mappings)
      ? (body as { mappings: { crawlEmailAccount?: unknown; userId?: unknown }[] }).mappings
      : null
    if (!items) {
      return NextResponse.json({ error: "mappings 必须为数组" }, { status: 400 })
    }

    const updates: { crawlEmailAccount: string; userId: string; userName: string }[] = []
    for (const item of items) {
      const crawlEmailAccount = String(item?.crawlEmailAccount || "").trim().toLowerCase()
      const userId = String(item?.userId || "").trim()
      if (!crawlEmailAccount) continue
      let userName = ""
      if (userId) {
        const user = await getUserById(userId)
        if (!user) {
          return NextResponse.json({ error: `用户不存在: ${userId}` }, { status: 400 })
        }
        userName = user.name || user.email || userId
      }
      updates.push({ crawlEmailAccount, userId, userName })
    }

    const data = saveDirectEmailVisibilityMappings(updates)
    // Bust list caches so 邮箱运维池 / 直投产品 pick up new visibility immediately.
    invalidateListResponseCache(EMAIL_OPS_POOL_KEY)
    return NextResponse.json({ data })
  } catch (e) {
    const message = e instanceof Error ? e.message : "保存失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
