import { NextResponse } from "next/server"
import fs from "fs"
import path from "path"

export const runtime = "nodejs"
export const dynamic = "force-static"

/**
 * Serves the pre-computed PCA loadings from data/pca_loadings.json.
 * Regenerate by running: python3 scripts/ma/export_pca_loadings.py
 */
export async function GET() {
  try {
    const filePath = path.join(process.cwd(), "data", "pca_loadings.json")
    const raw = fs.readFileSync(filePath, "utf-8")
    const data = JSON.parse(raw)
    return NextResponse.json(data)
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "pca_loadings.json not found" }, { status: 500 })
  }
}
