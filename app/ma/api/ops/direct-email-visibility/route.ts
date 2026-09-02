import { NextResponse } from "next/server"
import { listUsers } from "@/lib/server/users"
import {
  HIDDEN_VISIBILITY_SENTINEL,
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
    return NextResponse.json({ data: await listDirectEmailVisibilityRows() })
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
      ? (body as {
          mappings: {
            crawlEmailAccount?: unknown
            userId?: unknown
            userIds?: unknown
            hidden?: unknown
          }[]
        }).mappings
      : null
    if (!items) {
      return NextResponse.json({ error: "mappings 必须为数组" }, { status: 400 })
    }

    const allUsers = await listUsers()
    const userById = new Map(allUsers.map((u) => [u.id, u]))

    const updates: {
      crawlEmailAccount: string
      userIds: string[]
      userNames: string[]
      hidden: boolean
    }[] = []
    for (const item of items) {
      const crawlEmailAccount = String(item?.crawlEmailAccount || "").trim().toLowerCase()
      if (!crawlEmailAccount) continue
      const hidden =
        item?.hidden === true || String(item?.userId || "").trim() === HIDDEN_VISIBILITY_SENTINEL
      const fromList = Array.isArray(item?.userIds)
        ? item.userIds.map((id) => String(id || "").trim()).filter(Boolean)
        : []
      const legacyId = String(item?.userId || "").trim()
      const userIds = hidden
        ? []
        : Array.from(
            new Set(
              (fromList.length > 0
                ? fromList
                : legacyId && legacyId !== HIDDEN_VISIBILITY_SENTINEL
                  ? [legacyId]
                  : []
              ).filter((id) => id !== HIDDEN_VISIBILITY_SENTINEL),
            ),
          )
      const userNames: string[] = []
      for (const userId of userIds) {
        const user = userById.get(userId)
        if (!user) {
          return NextResponse.json({ error: `用户不存在: ${userId}` }, { status: 400 })
        }
        userNames.push(user.name || user.email || userId)
      }
      updates.push({ crawlEmailAccount, userIds, userNames, hidden })
    }

    const data = await saveDirectEmailVisibilityMappings(updates)
    // Bust list caches so 邮箱运维池 / 直投产品 pick up new visibility immediately.
    invalidateListResponseCache(EMAIL_OPS_POOL_KEY)
    return NextResponse.json({ data })
  } catch (e) {
    const message = e instanceof Error ? e.message : "保存失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
