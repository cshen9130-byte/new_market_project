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

/** Find a working Python executable, trying multiple candidates in order. */
async function findPython(scriptDir: string): Promise<string> {
  // 1. Project venv (highest priority)
  const venvPython =
    process.platform === "win32"
      ? path.join(scriptDir, ".venv", "Scripts", "python.exe")
      : path.join(scriptDir, ".venv", "bin", "python")
  if (existsSync(venvPython)) return venvPython

  // 2. Explicit override via env var
  const envPy = process.env.PYTHON_EXECUTABLE
  if (envPy && existsSync(envPy)) return envPy

  if (process.platform === "win32") {
    // 3. Windows Python Launcher (py.exe) — most reliable on Windows
    const pyLauncher = path.join(process.env.SystemRoot ?? "C:\\Windows", "py.exe")
    if (existsSync(pyLauncher)) return pyLauncher

    // 4. where.exe — find every python on PATH, return first that actually exists
    try {
      const { stdout } = await execFileAsync("where.exe", ["python"], { timeout: 5000 })
      for (const line of stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
        if (existsSync(line)) return line
      }
    } catch {
      /* where.exe not available or python not in PATH */
    }
  }

  // 5. Last resort — let the OS resolve it; will fail with a clear message
  return process.platform === "win32" ? "python" : "python3"
}

export async function GET() {
  const scriptDir = path.join(process.cwd(), "guoxin_strategy")
  const scriptPath = path.join(scriptDir, "generate_guoxin_word_report_db.py")
  const outputPath = path.join(scriptDir, "report_output", "国信期货交易策略分析报告.docx")

  if (!existsSync(scriptPath)) {
    return NextResponse.json({ error: "Python 报告脚本不存在" }, { status: 500 })
  }

  // Pre-flight: verify SSH tunnel is up before spending time loading Python
  const tunnelUp = await new Promise<boolean>((resolve) => {
    const sock = createConnection({ host: "127.0.0.1", port: 5433 })
    sock.setTimeout(2000)
    sock.on("connect", () => { sock.destroy(); resolve(true) })
    sock.on("error", () => resolve(false))
    sock.on("timeout", () => { sock.destroy(); resolve(false) })
  })
  if (!tunnelUp) {
    return NextResponse.json(
      { error: "数据库隧道未就绪，请先启动 SSH 隧道：ssh -L 5433:127.0.0.1:5432 root@8.154.33.143 -N -i ~/.ssh/id_ed25519_server" },
      { status: 503 },
    )
  }

  const pythonExe = await findPython(scriptDir)
  console.log("[download-report] Using Python:", pythonExe)

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
      timeout: 480_000, // 8 min — akshare market data fetch can be slow
    })
    if (stdout) console.log("[download-report] stdout:", stdout.slice(0, 1000))
    if (stderr) console.warn("[download-report] stderr:", stderr.slice(0, 1000))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const errStderr = (err as { stderr?: string }).stderr ?? ""
    const errStdout = (err as { stdout?: string }).stdout ?? ""
    const detail = [errStderr, errStdout].filter(Boolean).join("\n---stdout---\n") || msg
    console.error("[download-report] Python script failed:", detail.slice(0, 2000))
    return NextResponse.json(
      { error: "报告生成失败", detail },
      { status: 500 },
    )
  }

  if (!existsSync(outputPath)) {
    return NextResponse.json({ error: "脚本执行完毕但未找到输出文件" }, { status: 500 })
  }

  let fileBuffer: Buffer
  try {
    fileBuffer = await readFile(outputPath)
  } catch (err) {
    return NextResponse.json({ error: "无法读取输出文件" }, { status: 500 })
  }

  return new Response(fileBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      // RFC 5987 encoded filename for non-ASCII
      "Content-Disposition":
        "attachment; filename*=UTF-8''%E5%9B%BD%E4%BF%A1%E6%9C%9F%E8%B4%A7%E4%BA%A4%E6%98%93%E7%AD%96%E7%95%A5%E5%88%86%E6%9E%90%E6%8A%A5%E5%91%8A.docx",
    },
  })
}
