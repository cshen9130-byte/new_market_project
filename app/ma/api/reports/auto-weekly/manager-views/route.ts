import { NextResponse } from "next/server"
import { canAccessPfInvestmentPool } from "@/lib/permissions"
import {
  assignManagerViews,
  deleteManagerViewTemplate,
  getManagerViewsSnapshot,
  upsertManagerViewTemplate,
} from "@/lib/server/auto-weekly-manager-views"
import {
  getManagerViewRegenJob,
  startManagerViewRegenJob,
} from "@/lib/server/auto-weekly-holdings-view-job"
import { listTeamAutoWeeklyTemplateSubscriptions } from "@/lib/server/auto-weekly-reports"
import { lookupProductVolBands, resolveProductVolBand } from "@/lib/server/auto-weekly-vol-bands"
import { getAssignedManagerView } from "@/lib/server/auto-weekly-manager-views"
import { getRequestUser } from "@/lib/server/users"
import type { User } from "@/lib/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

async function requirePoolUser(req: Request) {
  const user = await getRequestUser(req)
  if (!user || !canAccessPfInvestmentPool(user as User | null)) {
    return { user: null, error: NextResponse.json({ error: "forbidden", code: "forbidden" }, { status: 403 }) }
  }
  return { user, error: null }
}

async function snapshotPayload() {
  const snap = getManagerViewsSnapshot()
  const subscriptions = await listTeamAutoWeeklyTemplateSubscriptions()
  const bands = await lookupProductVolBands(subscriptions)
  const products = subscriptions.map((product) => {
    const assigned = getAssignedManagerView(product.product_name, product.beian_hao)
    return {
      product_name: product.product_name,
      beian_hao: product.beian_hao,
      source: product.source,
      hasView: Boolean(assigned.text),
      templateId: assigned.templateId,
      text: assigned.text,
      volBand: resolveProductVolBand(product.beian_hao, bands),
    }
  })
  return { ...snap, products }
}

export async function GET(req: Request) {
  const gate = await requirePoolUser(req)
  if (gate.error) return gate.error

  const jobId = new URL(req.url).searchParams.get("jobId") || ""
  if (jobId) {
    const job = getManagerViewRegenJob(jobId)
    if (!job) return NextResponse.json({ error: "任务不存在" }, { status: 404 })
    return NextResponse.json({ ok: true, job })
  }

  return NextResponse.json({ ok: true, ...(await snapshotPayload()) })
}

export async function POST(req: Request) {
  const gate = await requirePoolUser(req)
  if (gate.error) return gate.error

  let body: {
    action?: string
    id?: string
    name?: string
    text?: string
    templateId?: string | null
    applyAll?: boolean
    regenerate?: boolean
    products?: Array<{ product_name?: string; beian_hao?: string | null }>
  } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    body = {}
  }

  const action = (body.action || "").trim()
  try {
    if (action === "upsertTemplate") {
      const template = upsertManagerViewTemplate({
        id: body.id,
        name: body.name || "",
        text: body.text || "",
      })
      return NextResponse.json({ ok: true, template, ...(await snapshotPayload()) })
    }

    if (action === "deleteTemplate") {
      const deleted = deleteManagerViewTemplate(body.id || "")
      if (!deleted) return NextResponse.json({ error: "模板不存在" }, { status: 404 })
      return NextResponse.json({ ok: true, ...(await snapshotPayload()) })
    }

    if (action === "assign") {
      const allProducts = await listTeamAutoWeeklyTemplateSubscriptions()
      const targets = body.applyAll
        ? allProducts
        : Array.isArray(body.products)
          ? body.products.map((row) => ({
              product_name: (row.product_name || "").trim(),
              beian_hao: row.beian_hao ?? null,
            }))
          : []
      const result = assignManagerViews(targets, body.text || "", body.templateId)
      let job = null
      if (body.regenerate !== false) {
        job = startManagerViewRegenJob(targets)
      }
      return NextResponse.json({
        ok: true,
        updated: result.updated,
        job,
        ...(await snapshotPayload()),
      })
    }

    return NextResponse.json({ error: "未知操作" }, { status: 400 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const status =
      message.includes("请") || message.includes("已有") || message.includes("不能") ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
