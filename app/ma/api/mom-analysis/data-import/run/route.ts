import { spawn } from "child_process"
import fs from "fs"
import path from "path"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function findPython(): string {
  if (process.env.PYTHON_EXECUTABLE) return process.env.PYTHON_EXECUTABLE
  const venvPy =
    process.platform === "win32"
      ? path.join(process.cwd(), ".venv", "Scripts", "python.exe")
      : path.join(process.cwd(), ".venv", "bin", "python3")
  if (fs.existsSync(venvPy)) return venvPy
  return process.platform === "win32" ? "python" : "python3"
}

export async function POST(request: Request) {
  const python = findPython()
  const script = path.join(process.cwd(), "scripts", "ma", "mom_data_etl.py")

  if (!fs.existsSync(script)) {
    return NextResponse.json({ error: `脚本不存在: ${script}` }, { status: 500 })
  }

  let skipDedup = false
  let skipMarketData = false
  try {
    const body = await request.json()
    if (body?.skipDedup) skipDedup = true
    if (body?.skipMarketData) skipMarketData = true
  } catch { /* no body or not JSON — use defaults */ }

  const args = [script]
  if (skipDedup) args.push("--skip-dedup")
  if (skipMarketData) args.push("--skip-market-data")

  return new Promise<Response>((resolve) => {
    const proc = spawn(python, args, {
      env: { ...process.env },
      cwd: process.cwd(),
    })

    let stdout = ""
    let stderr = ""

    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString() })
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString() })

    const timer = setTimeout(() => {
      proc.kill()
      resolve(NextResponse.json({ error: "ETL 运行超时（120s）" }, { status: 408 }))
    }, 120_000)

    proc.on("close", (code: number | null) => {
      clearTimeout(timer)
      const tail = (s: string) => s.slice(-3000)
      if (code === 0) {
        resolve(NextResponse.json({ ok: true, stdout: tail(stdout) }))
      } else {
        resolve(
          NextResponse.json(
            { error: `ETL 退出码 ${code ?? "unknown"}`, stderr: tail(stderr), stdout: tail(stdout) },
            { status: 500 },
          ),
        )
      }
    })

    proc.on("error", (err: Error) => {
      clearTimeout(timer)
      resolve(NextResponse.json({ error: `无法启动进程: ${err.message}` }, { status: 500 }))
    })
  })
}
