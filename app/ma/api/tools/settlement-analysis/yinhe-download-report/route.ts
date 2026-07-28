import path from "path"
import { existsSync } from "fs"
import { readFile } from "fs/promises"
import { execFile } from "child_process"
import { promisify } from "util"
import { createConnection } from "net"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const execFileAsync = promisify(execFile)

async function findPython(scriptDir: string): Promise<string> {
  const venvPython =
    process.platform === "win32"
      ? path.join(scriptDir, ".venv", "Scripts", "python.exe")
      : path.join(scriptDir, ".venv", "bin", "python")
  if (existsSync(venvPython)) return venvPython

  const guoxinVenv =
    process.platform === "win32"
      ? path.join(process.cwd(), "guoxin_strategy", ".venv", "Scripts", "python.exe")
      : path.join(process.cwd(), "guoxin_strategy", ".venv", "bin", "python")
  if (existsSync(guoxinVenv)) return guoxinVenv

  const envPy = process.env.PYTHON_EXECUTABLE
  if (envPy && existsSync(envPy)) return envPy

  if (process.platform === "win32") {
    const pyLauncher = path.join(process.env.SystemRoot ?? "C:\\Windows", "py.exe")
    if (existsSync(pyLauncher)) return pyLauncher
    try {
      const { stdout } = await execFileAsync("where.exe", ["python"], { timeout: 5000 })
      for (const line of stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
        if (existsSync(line)) return line
      }
    } catch {
      /* ignore */
    }
  }

  return process.platform === "win32" ? "python" : "python3"
}

export async function GET() {
  const scriptDir = path.join(process.cwd(), "yinhe_strategy")
  const scriptPath = path.join(scriptDir, "generate_yinhe_word_report_db.py")
  const outputPath = path.join(scriptDir, "report_output", "银河期货交易策略分析报告.docx")

  if (!existsSync(scriptPath)) {
    return NextResponse.json({ error: "Python 报告脚本不存在" }, { status: 500 })
  }

  let dbHost = "127.0.0.1"
  let dbPort = 5433
  const dbUrl = process.env.DATABASE_URL ?? ""
  if (dbUrl) {
    try {
      const u = new URL(dbUrl)
      if (u.hostname) dbHost = u.hostname
      if (u.port) dbPort = parseInt(u.port, 10)
    } catch {
      /* ignore */
    }
  }
  const tunnelUp = await new Promise<boolean>((resolve) => {
    const sock = createConnection({ host: dbHost, port: dbPort })
    sock.setTimeout(2000)
    sock.on("connect", () => {
      sock.destroy()
      resolve(true)
    })
    sock.on("error", () => resolve(false))
    sock.on("timeout", () => {
      sock.destroy()
      resolve(false)
    })
  })
  if (!tunnelUp) {
    return NextResponse.json(
      { error: `数据库端口 ${dbHost}:${dbPort} 不可达，请确认数据库或 SSH 隧道已启动` },
      { status: 503 },
    )
  }

  const pythonExe = await findPython(scriptDir)
  try {
    const { stdout, stderr } = await execFileAsync(pythonExe, ["-u", scriptPath], {
      cwd: scriptDir,
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
      },
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 180_000,
    })
    if (stdout) console.log("[yinhe-download-report] stdout:", stdout.slice(0, 1000))
    if (stderr) console.warn("[yinhe-download-report] stderr:", stderr.slice(0, 1000))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const errStderr = (err as { stderr?: string }).stderr ?? ""
    const errStdout = (err as { stdout?: string }).stdout ?? ""
    const detail = [errStderr, errStdout].filter(Boolean).join("\n---stdout---\n") || msg
    return NextResponse.json({ error: "报告生成失败", detail }, { status: 500 })
  }

  if (!existsSync(outputPath)) {
    return NextResponse.json({ error: "脚本执行完毕但未找到输出文件" }, { status: 500 })
  }

  const fileBuffer = await readFile(outputPath)
  return new Response(fileBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition":
        "attachment; filename*=UTF-8''%E9%93%B6%E6%B2%B3%E6%9C%9F%E8%B4%A7%E4%BA%A4%E6%98%93%E7%AD%96%E7%95%A5%E5%88%86%E6%9E%90%E6%8A%A5%E5%91%8A.docx",
    },
  })
}
