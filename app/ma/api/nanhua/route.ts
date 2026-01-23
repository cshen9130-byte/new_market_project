import { NextResponse } from "next/server"
import { spawn } from "child_process"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
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

  return new Promise((resolve) => {
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
          resolve(NextResponse.json(parsed, { status: 200 }))
        } catch (e: any) {
          console.error("[nanhua] json parse failed", e, { stdout, stderr })
          resolve(NextResponse.json({ error: `json parse failed: ${e?.message}`, stdout, stderr }, { status: 500 }))
        }
      })
    } catch (e: any) {
      resolve(NextResponse.json({ error: e?.message || "unknown" }, { status: 500 }))
    }
  })
}
