import { spawn, type ChildProcess } from "child_process"
import fs from "fs"
import path from "path"
import type { Readable } from "stream"

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
  let reset = false
  let renameFolders: string[] | null = null
  try {
    const body = await request.json()
    if (body?.skipDedup) skipDedup = true
    if (body?.skipMarketData) skipMarketData = true
    if (body?.reset) reset = true
    if (Array.isArray(body?.folders) && body.folders.length > 0) {
      renameFolders = body.folders as string[]
    }
  } catch { /* no body or not JSON — use defaults */ }

  const args = ["-X", "utf8", script]
  if (skipDedup) args.push("--skip-dedup")
  if (skipMarketData) args.push("--skip-market-data")
  if (reset) args.push("--reset")

  const encoder = new TextEncoder()
  let proc: ChildProcess | null = null

  const stream = new ReadableStream({
    async start(controller) {
      const send = (line: string) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(line)}\n\n`))
      }

      proc = spawn(python, args, {
        env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
        cwd: process.cwd(),
      })

      const emitChunk = (chunk: string, tag: string, pending: { buf: string }) => {
        pending.buf += chunk
        const lines = pending.buf.split("\n")
        pending.buf = lines.pop() ?? ""
        for (const line of lines) {
          const t = line.replace(/\r/g, "").trim()
          if (t) send(tag ? `[${tag}] ${t}` : t)
        }
        const cr = pending.buf.lastIndexOf("\r")
        if (cr >= 0) {
          const progress = pending.buf.slice(cr + 1).trim()
          pending.buf = ""
          if (progress) send(tag ? `[${tag}] ${progress}` : progress)
        }
      }

      const stdoutPending = { buf: "" }
      const stderrPending = { buf: "" }
      // Windows Python still writes the ANSI code page (GBK) on some launches.
      // UTF-8 decoding then shows "??". Fall back to GBK when that happens.
      const decodeProcessOutput = (stream: Readable | null, tag: string, pending: { buf: string }) => {
        if (!stream) return
        let encoding: "utf-8" | "gbk" = "utf-8"
        const utf8 = new TextDecoder("utf-8")
        const take = (d: Buffer) => {
          let text: string
          if (encoding === "gbk") {
            text = new TextDecoder("gbk").decode(d)
          } else {
            text = utf8.decode(d, { stream: true })
            if (text.includes("\uFFFD")) {
              encoding = "gbk"
              text = new TextDecoder("gbk").decode(d)
            }
          }
          emitChunk(text, tag, pending)
        }
        stream.on("data", (d: Buffer) => take(d))
        stream.on("end", () => {
          if (encoding === "utf-8") emitChunk(utf8.decode(), tag, pending)
        })
      }
      decodeProcessOutput(proc.stdout, "", stdoutPending)
      decodeProcessOutput(proc.stderr, "stderr", stderrPending)

      const ETL_TIMEOUT_MS = 1_800_000 // 30 min — market-data EmQuant steps can exceed 10 min
      const timer = setTimeout(() => {
        proc?.kill()
        send("__EXIT__:timeout")
        controller.close()
      }, ETL_TIMEOUT_MS)

      proc.on("close", async (code: number | null) => {
        clearTimeout(timer)
        // Drop today's MOM chart files before warm-cache refills them. The ETL
        // script does this too; doing it here covers a run that died after the
        // rows were committed and before that cleanup line.
        try {
          const { clearTodayMomCache } = await import("@/lib/server/mom-cache")
          clearTodayMomCache()
          send("[cache] 已清除今日 MOM 图表缓存")
        } catch (e) {
          send(`[cache] 清除 MOM 图表缓存失败 (非致命): ${e instanceof Error ? e.message : String(e)}`)
        }
        if (code === 0) {
          if (renameFolders && renameFolders.length > 0) {
            send(`[rename] ETL 完成，开始标准化命名（${renameFolders.length} 个文件夹）…`)
            try {
              const { formatStandardizeNamesSummary, standardizeMomDataNames } = await import(
                "@/lib/server/mom-data-standardize-names"
              )
              const renameResult = standardizeMomDataNames(renameFolders)
              if (renameResult.nothingToDo) {
                send("[rename] 所有文件名和文件夹名均符合标准格式。")
              } else {
                for (const line of formatStandardizeNamesSummary(renameResult)) {
                  send(`[rename] ${line}`)
                }
                for (const r of renameResult.renamedFolders.slice(0, 30)) {
                  send(`[rename] 📁 ${r}`)
                }
                for (const r of renameResult.renamedFiles.slice(0, 30)) {
                  send(`[rename] 📄 ${r}`)
                }
                for (const r of renameResult.duplicates.slice(0, 30)) {
                  send(`[rename] ⚠ ${r}`)
                }
                const extraFiles = renameResult.renamedFiles.length - 30
                const extraFolders = renameResult.renamedFolders.length - 30
                const extraDupes = renameResult.duplicates.length - 30
                if (extraFiles > 0) send(`[rename] … 另有 ${extraFiles} 个文件重命名`)
                if (extraFolders > 0) send(`[rename] … 另有 ${extraFolders} 个文件夹重命名`)
                if (extraDupes > 0) send(`[rename] … 另有 ${extraDupes} 个重复项`)
              }
              if (renameResult.errors.length > 0) {
                send(`[rename] 警告: ${renameResult.errors.length} 个文件无法处理`)
                for (const err of renameResult.errors.slice(0, 10)) {
                  send(`[rename] ⚠ ${err}`)
                }
              }
            } catch (e) {
              send(`[rename] 标准化命名失败 (非致命): ${e instanceof Error ? e.message : String(e)}`)
            }
          }

          // Chart warmup calls about 50 analysis routes one after another.
          // The rows are already committed, so the import must not wait on it.
          send("[warm-cache] 图表缓存在后台预热，导入已经完成")
          const origin = new URL(request.url).origin
          void fetch(`${origin}/ma/api/mom-analysis/warm-cache`).catch(() => {})

          try {
            const tsxCli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs")
            const quantScript = path.join(process.cwd(), "scripts", "ma", "precompute_quant_strategy.ts")
            const child = spawn(process.execPath, [tsxCli, quantScript, "--force"], {
              cwd: process.cwd(),
              stdio: "ignore",
              windowsHide: true,
            })
            child.unref()
            send("[quant-strategy] 已在后台重算量化策略分析，页面会在算完后直接读缓存")
          } catch (e) {
            send(`[quant-strategy] 后台重算未启动 (非致命): ${e instanceof Error ? e.message : String(e)}`)
          }

          try {
            const tsxCli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs")
            const positionScript = path.join(process.cwd(), "scripts", "ma", "precompute_quant_positions.ts")
            const child = spawn(process.execPath, [tsxCli, positionScript], {
              cwd: process.cwd(),
              stdio: "ignore",
              windowsHide: true,
            })
            child.unref()
            send("[quant-positions] 已在后台重算当日持仓，页面会直接读缓存")
          } catch (e) {
            send(`[quant-positions] 后台重算未启动 (非致命): ${e instanceof Error ? e.message : String(e)}`)
          }

          try {
            const tsxCli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs")
            const varScript = path.join(process.cwd(), "scripts", "ma", "persist_mom_position_var.ts")
            const child = spawn(process.execPath, [tsxCli, varScript], {
              cwd: process.cwd(),
              stdio: "ignore",
              windowsHide: true,
            })
            child.unref()
            send("[var-history] 已在后台把板块和品种持仓 VaR 写入数据库")
          } catch (e) {
            send(`[var-history] 后台入库未启动 (非致命): ${e instanceof Error ? e.message : String(e)}`)
          }
        }
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
      proc?.kill()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
