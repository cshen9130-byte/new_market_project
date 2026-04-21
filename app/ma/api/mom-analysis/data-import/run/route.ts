import { spawn, type ChildProcess } from "child_process"
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

  const { readConfig, fetchSettlementFiles } = await import("@/lib/server/settlement-email")
  const settlementCfg = readConfig()

  const encoder = new TextEncoder()
  let proc: ChildProcess | null = null

  const stream = new ReadableStream({
    async start(controller) {
      const send = (line: string) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(line)}\n\n`))
      }

      // Step 1: fetch settlement files from mailbox before running ETL
      if (settlementCfg.enabled && settlementCfg.email && settlementCfg.pass) {
        send("[settlement] 正在从邮箱获取结算单附件…")
        try {
          const result = await fetchSettlementFiles()
          if (result.downloaded.length > 0) {
            send(`[settlement] 已下载 ${result.downloaded.length} 个文件: ${result.downloaded.join(", ")}`)
          } else if (result.errors.length > 0) {
            send(`[settlement] 获取完成，有 ${result.errors.length} 个错误: ${result.errors.join("; ")}`)
          } else {
            const skippedNote = result.skipped.length > 0 ? `已跳过 ${result.skipped.length}` : "收件箱中无匹配附件"
            send(`[settlement] 无新文件 (${skippedNote})`)
          }
        } catch (e) {
          send(`[settlement] 获取失败 (非致命): ${e instanceof Error ? e.message : String(e)}`)
        }
      }

      // Step 1b: incremental ETL of account summary + transaction records into PostgreSQL
      try {
        send("[settlement-etl] 正在同步结算数据至数据库（增量）…")
        const { runSettlementFilesETL } = await import("@/lib/server/settlement-account-etl")
        const etlRes = await runSettlementFilesETL("incremental")
        send(`[settlement-etl] 资金状况: 新增 ${etlRes.accountSummary.inserted}, 更新 ${etlRes.accountSummary.updated}, 跳过 ${etlRes.accountSummary.skipped}`)
        send(`[settlement-etl] 成交记录: 新增 ${etlRes.transactions.inserted}, 更新 ${etlRes.transactions.updated}, 跳过 ${etlRes.transactions.skipped}`)
        send(`[settlement-etl] 持仓明细: 新增 ${etlRes.positions.inserted}, 更新 ${etlRes.positions.updated}, 跳过 ${etlRes.positions.skipped}`)
        const allErrors = [...etlRes.accountSummary.errors, ...etlRes.transactions.errors, ...etlRes.positions.errors]
        if (allErrors.length > 0) {
          send(`[settlement-etl] 警告: ${allErrors.join("; ")}`)
        }
      } catch (e) {
        send(`[settlement-etl] 同步失败 (非致命): ${e instanceof Error ? e.message : String(e)}`)
      }

      // Step 2: spawn ETL process
      proc = spawn(python, args, {
        env: { ...process.env },
        cwd: process.cwd(),
      })

      const splitLines = (buf: string, tag: string) => {
        for (const line of buf.split("\n")) {
          const t = line.trim()
          if (t) send(tag ? `[${tag}] ${t}` : t)
        }
      }

      proc.stdout?.on("data", (d: Buffer) => splitLines(d.toString(), ""))
      proc.stderr?.on("data", (d: Buffer) => splitLines(d.toString(), "stderr"))

      const timer = setTimeout(() => {
        proc?.kill()
        send("__EXIT__:timeout")
        controller.close()
      }, 600_000)

      proc.on("close", async (code: number | null) => {
        clearTimeout(timer)
        if (code === 0) {
          send("[warm-cache] ETL 完成，开始预热图表缓存…")
          try {
            const origin = new URL(request.url).origin
            const resp = await fetch(`${origin}/ma/api/mom-analysis/warm-cache`)
            const body = await resp.json() as { ok: boolean; totalMs?: number; results?: { route: string; ok: boolean }[] }
            const ok = body.results?.filter((r: { ok: boolean }) => r.ok).length ?? 0
            const total = body.results?.length ?? 0
            send(`[warm-cache] 缓存预热完成: ${ok}/${total} 路由成功 (${((body.totalMs ?? 0) / 1000).toFixed(1)}s)`)
          } catch (e) {
            send(`[warm-cache] 缓存预热失败 (非致命): ${e instanceof Error ? e.message : String(e)}`)
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
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  })
}
