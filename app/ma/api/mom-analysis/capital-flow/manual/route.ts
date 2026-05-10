import { NextResponse } from "next/server"
import { existsSync, readdirSync, unlinkSync } from "fs"
import { join } from "path"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MOM_CACHE_DIR = join(process.cwd(), "data", "mom-cache")

function beijingToday(): string {
  const d = new Date(Date.now() + 8 * 3600_000)
  return d.toISOString().slice(0, 10)
}

function clearNavCaches() {
  if (!existsSync(MOM_CACHE_DIR)) return
  const today = beijingToday()
  const targets = ["_product-nav", "_margin-risk"]
  for (const f of readdirSync(MOM_CACHE_DIR)) {
    if (!f.startsWith(`${today}_`)) continue
    if (!targets.some((k) => f.includes(k))) continue
    try {
      unlinkSync(join(MOM_CACHE_DIR, f))
    } catch {
      // ignore cache deletion failures
    }
  }
}

async function ensureManualFlowTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS mom_manual_capital_flows (
      id          BIGSERIAL PRIMARY KEY,
      flow_date   DATE            NOT NULL,
      direction   VARCHAR(8)      NOT NULL CHECK (direction IN ('in', 'out')),
      flow_value  NUMERIC(20, 2)  NOT NULL CHECK (flow_value > 0),
      net_flow    NUMERIC(20, 2)  NOT NULL,
      note        VARCHAR(200),
      created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
    )
  `)
}

function normalizeDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const s = raw.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T00:00:00+08:00`)
  if (Number.isNaN(d.getTime())) return null
  return s
}

function parsePositiveNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : null
  if (typeof raw !== "string") return null
  const s = raw.replace(/,/g, "").trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? n : null
}

export async function GET() {
  try {
    await ensureManualFlowTable()
    const rows = await query<{
      id: string
      flow_date: string
      direction: "in" | "out"
      flow_value: string
      net_flow: string
      note: string | null
      created_at: string
    }>(`
      SELECT
        id::text,
        flow_date::text,
        direction,
        flow_value::text,
        net_flow::text,
        note,
        created_at::text
      FROM mom_manual_capital_flows
      ORDER BY flow_date DESC, id DESC
      LIMIT 200
    `)

    return NextResponse.json({ ok: true, rows })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "查询失败" },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    await ensureManualFlowTable()

    const body = await request.json().catch(() => ({})) as {
      date?: unknown
      direction?: unknown
      value?: unknown
      note?: unknown
    }

    const date = normalizeDate(body.date)
    if (!date) {
      return NextResponse.json({ error: "日期格式无效，请使用 YYYY-MM-DD" }, { status: 400 })
    }

    const direction = body.direction === "out" ? "out" : body.direction === "in" ? "in" : null
    if (!direction) {
      return NextResponse.json({ error: "direction 仅支持 in 或 out" }, { status: 400 })
    }

    const value = parsePositiveNumber(body.value)
    if (value == null) {
      return NextResponse.json({ error: "金额必须为大于 0 的数字" }, { status: 400 })
    }

    const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) : null
    const netFlow = direction === "in" ? value : -value

    const inserted = await query<{
      id: string
      flow_date: string
      direction: "in" | "out"
      flow_value: string
      net_flow: string
      note: string | null
      created_at: string
    }>(
      `INSERT INTO mom_manual_capital_flows (flow_date, direction, flow_value, net_flow, note)
       VALUES ($1::date, $2, $3, $4, $5)
       RETURNING id::text, flow_date::text, direction, flow_value::text, net_flow::text, note, created_at::text`,
      [date, direction, value, netFlow, note],
    )

    clearNavCaches()

    return NextResponse.json({
      ok: true,
      message: `已录入${direction === "in" ? "入金" : "出金"}：${date}，${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      row: inserted[0],
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "保存失败" },
      { status: 500 },
    )
  }
}

export async function PUT(request: Request) {
  try {
    await ensureManualFlowTable()

    const body = await request.json().catch(() => ({})) as {
      id?: unknown
      date?: unknown
      direction?: unknown
      value?: unknown
      note?: unknown
    }

    const id = typeof body.id === "string" || typeof body.id === "number" ? Number(body.id) : null
    if (!id || !Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "无效的记录 id" }, { status: 400 })
    }

    const date = normalizeDate(body.date)
    if (!date) {
      return NextResponse.json({ error: "日期格式无效，请使用 YYYY-MM-DD" }, { status: 400 })
    }

    const direction = body.direction === "out" ? "out" : body.direction === "in" ? "in" : null
    if (!direction) {
      return NextResponse.json({ error: "direction 仅支持 in 或 out" }, { status: 400 })
    }

    const value = parsePositiveNumber(body.value)
    if (value == null) {
      return NextResponse.json({ error: "金额必须为大于 0 的数字" }, { status: 400 })
    }

    const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) : null
    const netFlow = direction === "in" ? value : -value

    const updated = await query<{ id: string }>(
      `UPDATE mom_manual_capital_flows
       SET flow_date = $2::date, direction = $3, flow_value = $4, net_flow = $5, note = $6
       WHERE id = $1
       RETURNING id::text`,
      [id, date, direction, value, netFlow, note],
    )

    if (updated.length === 0) {
      return NextResponse.json({ error: "记录不存在" }, { status: 404 })
    }

    clearNavCaches()
    return NextResponse.json({ ok: true, message: "已更新记录" })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "更新失败" },
      { status: 500 },
    )
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureManualFlowTable()

    const body = await request.json().catch(() => ({})) as { id?: unknown }
    const id = typeof body.id === "string" || typeof body.id === "number" ? Number(body.id) : null
    if (!id || !Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "无效的记录 id" }, { status: 400 })
    }

    const deleted = await query<{ id: string }>(
      `DELETE FROM mom_manual_capital_flows WHERE id = $1 RETURNING id::text`,
      [id],
    )

    if (deleted.length === 0) {
      return NextResponse.json({ error: "记录不存在" }, { status: 404 })
    }

    clearNavCaches()
    return NextResponse.json({ ok: true, message: "已删除记录" })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "删除失败" },
      { status: 500 },
    )
  }
}
