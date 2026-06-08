import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const managerName = String(body.manager_name || "").trim()
    const registrationNo = String(body.registration_no || "").trim()
    const contactPerson = body.contact_person ? String(body.contact_person).trim() : null

    if (!managerName) {
      return NextResponse.json({ error: "manager_name_required" }, { status: 400 })
    }
    if (!registrationNo) {
      return NextResponse.json({ error: "registration_no_required" }, { status: 400 })
    }

    const existing = await query<{ id: number }>(
      `SELECT id FROM investment_tracking_managers WHERE registration_no = $1 LIMIT 1`,
      [registrationNo],
    )
    if (existing.length > 0) {
      return NextResponse.json({ error: "already_exists" }, { status: 409 })
    }

    const rows = await query<{ id: number }>(
      `INSERT INTO investment_tracking_managers (
         manager_name, registration_no, contact_person, tracking_date
       ) VALUES ($1, $2, $3, CURRENT_DATE)
       RETURNING id`,
      [managerName, registrationNo, contactPerson],
    )

    return NextResponse.json({ ok: true, id: rows[0]?.id })
  } catch (err) {
    console.error("[tracking-managers/POST]", err)
    return NextResponse.json({ error: "Failed to add tracking manager" }, { status: 500 })
  }
}
