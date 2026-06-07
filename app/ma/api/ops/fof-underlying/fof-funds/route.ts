import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Search FOF parent funds for the filter dropdown. */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const q = (searchParams.get("q") || "").trim()

    const rows = q
      ? await query<{ register_number: string; product_name: string }>(
          `SELECT register_number, product_name
           FROM fof_mom_tracking
           WHERE product_name ILIKE $1 OR register_number ILIKE $1
           ORDER BY product_name
           LIMIT 20`,
          [`%${q}%`],
        )
      : await query<{ register_number: string; product_name: string }>(
          `SELECT register_number, product_name
           FROM fof_mom_tracking
           ORDER BY product_name
           LIMIT 20`,
        )

    return NextResponse.json(rows)
  } catch (err) {
    console.error("[fof-underlying/fof-funds]", err)
    return NextResponse.json([])
  }
}
