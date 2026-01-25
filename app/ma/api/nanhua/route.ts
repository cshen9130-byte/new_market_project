import { NextResponse } from "next/server"
import { spawn } from "child_process"
import fs from "fs/promises"
import path from "path"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  // Cache target: last full calendar year
  const now = new Date()
  const targetYear = now.getFullYear() - 1
  // Desired end date: today (so range is last year through today)
  function desiredEndDateToday(): string {
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, "0")
    const d = String(now.getDate()).padStart(2, "0")
    return `${y}-${m}-${d}`
  }
  const desiredEnd = desiredEndDateToday()

  // Try returning cached NHCI data from local filesystem
  const cacheDir = process.env.NHCI_CACHE_DIR || path.join(process.cwd(), "data")
  const cacheFile = path.join(cacheDir, "nhci_cache.json")
  try {
    const txt = await fs.readFile(cacheFile, "utf-8")
    const json = JSON.parse(txt)
    const cached = json?.[String(targetYear)]
    if (
      cached &&
      Array.isArray(cached?.data) &&
      cached.data.length > 0 &&
      typeof cached?.end === "string" &&
      cached.end === desiredEnd
    ) {
      // Align with original response shape
      return NextResponse.json(cached, { status: 200 })
    }
  } catch {}

  // Prepare env for Python script
  const env = {
    ...process.env,
    // Expect these to be set in .env.local
    EMQ_USERNAME: process.env.EMQ_USERNAME,
    EMQ_PASSWORD: process.env.EMQ_PASSWORD,
  }

  // Run the Python script to fetch NHCI data
  const scriptPath = process.cwd() + "/scripts/ma/get_nanhua_index.py"
  const isWin = process.platform === "win32"
  let pythonExe = process.env.PYTHON_EXE
  let args: string[] = []
  if (isWin && !pythonExe) {
    pythonExe = "py"
    args = ["-3", scriptPath]
  } else {
    pythonExe = pythonExe || "python"
    if ((pythonExe || "").toLowerCase() === "py") {
      args = ["-3", scriptPath]
    } else {
      args = [scriptPath]
    }
  }

  const result: any = await new Promise((resolve) => {
    try {
      const proc = spawn(pythonExe, args, { env })
      let stdout = ""
      let stderr = ""
      proc.stdout.on("data", (d) => (stdout += d.toString()))
      proc.stderr.on("data", (d) => (stderr += d.toString()))
      proc.on("error", (err) => {
        console.error("[nanhua] spawn error", err)
        resolve(NextResponse.json({ error: `spawn failed: ${err.message}` }, { status: 500 }))
      })
      proc.on("close", (code) => {
        if (code !== 0) {
          resolve(
            NextResponse.json(
              { error: `python exited with code ${code}`, stderr, stdout },
              { status: 502 },
            ),
          )
          return
        }
        try {
          const text = (stdout || "").trim()
          let parsed: any
          try {
            parsed = JSON.parse(text)
          } catch (_e) {
            // Fallback: attempt to extract the last JSON object from mixed output
            const first = text.indexOf("{")
            const last = text.lastIndexOf("}")
            if (first !== -1 && last !== -1 && last > first) {
              const candidate = text.substring(first, last + 1)
              parsed = JSON.parse(candidate)
            } else {
              throw _e
            }
          }
          // inject a source flag for visibility
          ;(parsed as any).source = (parsed as any).error ? "error" : "emquant"
          // Return parsed result; caller will handle caching and response
          resolve(parsed)
        } catch (e: any) {
          console.error("[nanhua] json parse failed", e, { stdout, stderr })
          resolve({ error: `json parse failed: ${e?.message}`, stdout, stderr })
        }
      })
    } catch (e: any) {
      resolve({ error: e?.message || "unknown" })
    }
  })

  if (result?.error) {
    return NextResponse.json(result, { status: 500 })
  }

  // Write result to local cache keyed by target year
  try {
    await fs.mkdir(cacheDir, { recursive: true })
    let existing: any = {}
    try {
      const txt = await fs.readFile(cacheFile, "utf-8")
      existing = JSON.parse(txt)
    } catch {}
    existing[String(targetYear)] = result
    await fs.writeFile(cacheFile, JSON.stringify(existing), "utf-8")
  } catch {}

  return NextResponse.json(result, { status: 200 })
}
