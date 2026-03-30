import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const DEFAULTS = { mother_rate: 0.35, child_rate: 0.20 }

async function readRates(): Promise<{ motherRate: number; childRate: number }> {
  try {
    const rows = await query<{ key: string; value: string }>(
      `SELECT key, value::text FROM mom_carry_rates WHERE key IN ('mother_rate', 'child_rate')`
    )
    const map = Object.fromEntries(rows.map((r) => [r.key, parseFloat(r.value)]))
    return {
      motherRate: map["mother_rate"] ?? DEFAULTS.mother_rate,
      childRate:  map["child_rate"]  ?? DEFAULTS.child_rate,
    }
  } catch {
    return { motherRate: DEFAULTS.mother_rate, childRate: DEFAULTS.child_rate }
  }
}

export async function GET() {
  try {
    const rates = await readRates()
    return NextResponse.json({ ok: true, ...rates })
  } catch (err: unknown) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json() as { motherRate?: number; childRate?: number }

    if (body.motherRate !== undefined) {
      const v = Number(body.motherRate)
      if (isNaN(v) || v < 0 || v > 1) return NextResponse.json({ ok: false, error: "母层报酬率须在 0–1 之间" }, { status: 400 })
      await query(
        `INSERT INTO mom_carry_rates (key, value) VALUES ('mother_rate', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [v]
      )
    }
    if (body.childRate !== undefined) {
      const v = Number(body.childRate)
      if (isNaN(v) || v < 0 || v > 1) return NextResponse.json({ ok: false, error: "子层报酬率须在 0–1 之间" }, { status: 400 })
      await query(
        `INSERT INTO mom_carry_rates (key, value) VALUES ('child_rate', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [v]
      )
    }

    const rates = await readRates()
    return NextResponse.json({ ok: true, ...rates })
  } catch (err: unknown) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
