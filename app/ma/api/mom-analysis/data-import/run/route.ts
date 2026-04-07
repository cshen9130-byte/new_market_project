import { spawn } from "child_process"
import fs from "fs"
import path from "path"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function findPython(): string {
  if (process.env.PYTHON_EXECUTABLE) return process.env.PYTHON_EXECUTABLE
  const cwd = process.cwd()
  const candidates =
    process.platform === "win32"
      ? [
          path.join(cwd, ".venv", "Scripts", "python.exe"),
          path.join(cwd, "economy", ".venv", "Scripts", "python.exe"),
          path.join(cwd, "..", "economy", ".venv", "Scripts", "python.exe"),
        ]
      : [
          path.join(cwd, ".venv", "bin", "python3"),
          path.join(cwd, "economy", ".venv", "bin", "python3"),
          path.join(cwd, "..", "economy", ".venv", "bin", "python3"),
        ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return process.platform === "win32" ? "python" : "python3"
}

export async function POST(request: Request) {
  const python = findPython()
  const script = path.join(process.cwd(), "scripts", "ma", "mom_data_etl.py")

  if (!fs.existsSync(script)) {
    return Response.json({ error: `脚本不存在: ${script}` }, { status: 500 })
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

  const proc = spawn(python, args, {
    env: { ...process.env },
    cwd: process.cwd(),
  })

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      const send = (line: string) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(line)}\n\n`))
      }

      const splitLines = (buf: string, tag: string) => {
        for (const line of buf.split("\n")) {
          const t = line.trim()
          if (t) send(tag ? `[${tag}] ${t}` : t)
        }
      }

      proc.stdout?.on("data", (d: Buffer) => splitLines(d.toString(), ""))
      proc.stderr?.on("data", (d: Buffer) => splitLines(d.toString(), "stderr"))

      const timer = setTimeout(() => {
        proc.kill()
        send("__EXIT__:timeout")
        controller.close()
      }, 600_000)

      proc.on("close", (code: number | null) => {
        clearTimeout(timer)
        send(`__EXIT__:${code ?? "unknown"}`)
        controller.close()
      })

      proc.on("error", (err: Error) => {
        clearTimeout(timer)
        send(`[error] 无法启动进程: ${err.message}`)
        send("__EXIT__:error")
        controller.close()
      })
    },
    cancel() {
      proc.kill()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  })
}
