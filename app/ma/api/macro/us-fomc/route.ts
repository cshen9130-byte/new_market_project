import { existsSync, readFileSync } from "fs"
import path from "path"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * US FOMC / CPI / jobs payload for /ma/dashboard/macro-market.
 * Prefers the file written by scripts/ma/fetch_us_macro.py so a daily ETL
 * shows up without rebuilding Next.js. Falls back to the bundled snapshot.
 */
export async function GET() {
  const runtime = path.join(process.cwd(), "data", "us-macro", "fomc-cpi.json")
  const bundled = path.join(process.cwd(), "lib", "ma", "fomc-cpi-data.json")
  const file = existsSync(runtime) ? runtime : bundled
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as unknown
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "read failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
