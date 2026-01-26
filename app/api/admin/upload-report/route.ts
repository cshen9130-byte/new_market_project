import { NextResponse } from "next/server"
import { writeFile, mkdir, stat, rename } from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { spawn } from "child_process"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const form = await req.formData()
    const file = form.get("file")
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "missing file" }, { status: 400 })
    }
    const name = (file.name || "report.html").toLowerCase()
    const isHtml = name.endsWith(".html") || (file.type || "").includes("html")
    if (!isHtml) {
      return NextResponse.json({ ok: false, error: "only .html allowed" }, { status: 400 })
    }

    const projectRoot = process.cwd()
    const targetDir = path.join(projectRoot, "public", "mom_report")
    const targetFile = path.join(targetDir, "report.html")

    if (!existsSync(targetDir)) {
      await mkdir(targetDir, { recursive: true })
    }

    // Backup existing report if present
    try {
      const st = await stat(targetFile)
      if (st.isFile()) {
        const ts = new Date().toISOString().replace(/[:.]/g, "-")
        const backup = path.join(targetDir, `report.backup.${ts}.html`)
        await rename(targetFile, backup)
      }
    } catch {}

    const buf = Buffer.from(await file.arrayBuffer())
    await writeFile(targetFile, buf)
    // Best-effort sync to the Nginx-served path if present (avoids stale content)
    const webMomPath = process.env.MOM_REPORT_WEB_ROOT || "/var/www/market_dashboard_website/mom_report"
    try {
      const webTarget = path.join(webMomPath, "report.html")
      // Write directly if we have permission
      await mkdir(webMomPath, { recursive: true })
      await writeFile(webTarget, buf)
    } catch (e) {
      // Ignore permission errors; ops script will sync on deploy
    }

    return NextResponse.json({ ok: true, path: "/mom_report/report.html", size: buf.length })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 })
  }
}
