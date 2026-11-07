import { NextResponse } from "next/server"
import { isAdmin } from "@/lib/permissions"
import type { User } from "@/lib/auth"
import { getYingmiPrivateFundEtlStatus, startYingmiPrivateFundEtl } from "@/lib/server/yingmi-private-fund-etl-job"
import { getRequestUser } from "@/lib/server/users"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const user = await getRequestUser(req)
  if (!isAdmin(user as User | null)) {
    return NextResponse.json({ error: "仅管理员可手动拉取" }, { status: 403 })
  }
  const started = startYingmiPrivateFundEtl({ force: true })
  if (!started.ok) {
    return NextResponse.json({ ok: false, reason: started.reason, status: getYingmiPrivateFundEtlStatus() }, { status: 409 })
  }
  return NextResponse.json({ ok: true, status: getYingmiPrivateFundEtlStatus() })
}
