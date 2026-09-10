/**
 * Local stdio MCP (repo / Cursor). Production users should use
 * http://8.154.33.143/ma/api/fund-data/mcp instead.
 */

import { loadProjectEnv } from "./load-project-env"
import { handleFundDataMcpRpc, type McpJsonRpc } from "@/lib/server/fund-data-mcp"

loadProjectEnv()

type JsonRpcId = string | number | null

function writeMessage(message: unknown): void {
  const json = JSON.stringify(message)
  const payload = Buffer.from(json, "utf8")
  const header = Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, "utf8")
  process.stdout.write(Buffer.concat([header, payload]))
}

function errResult(id: JsonRpcId, code: number, message: string): void {
  if (id === undefined) return
  writeMessage({ jsonrpc: "2.0", id, error: { code, message } })
}

async function handleRequest(msg: McpJsonRpc): Promise<void> {
  const reply = await handleFundDataMcpRpc(msg)
  if (reply) writeMessage(reply)
}

function parseFrames(buffer: Buffer): { messages: McpJsonRpc[]; rest: Buffer } {
  const messages: McpJsonRpc[] = []
  let rest = buffer
  while (rest.length > 0) {
    const headerEnd = rest.indexOf("\r\n\r\n")
    if (headerEnd !== -1) {
      const header = rest.subarray(0, headerEnd).toString("utf8")
      const match = header.match(/Content-Length:\s*(\d+)/i)
      if (!match) {
        rest = rest.subarray(headerEnd + 4)
        continue
      }
      const length = parseInt(match[1], 10)
      const start = headerEnd + 4
      if (rest.length < start + length) break
      const body = rest.subarray(start, start + length).toString("utf8")
      rest = rest.subarray(start + length)
      try {
        messages.push(JSON.parse(body) as McpJsonRpc)
      } catch (err) {
        process.stderr.write(`[fund-data-mcp] invalid json: ${err}\n`)
      }
      continue
    }

    const newline = rest.indexOf(0x0a)
    if (newline === -1) break
    const line = rest.subarray(0, newline).toString("utf8").replace(/\r$/, "").trim()
    rest = rest.subarray(newline + 1)
    if (!line) continue
    try {
      messages.push(JSON.parse(line) as McpJsonRpc)
    } catch {
      rest = Buffer.concat([Buffer.from(`${line}\n`, "utf8"), rest])
      break
    }
  }
  return { messages, rest }
}

async function main(): Promise<void> {
  process.stderr.write("[fund-data-mcp] listening on stdio\n")
  let buffer: Buffer = Buffer.alloc(0)
  process.stdin.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]) as Buffer
    const parsed = parseFrames(buffer)
    buffer = parsed.rest
    for (const msg of parsed.messages) {
      void handleRequest(msg).catch((err) => {
        process.stderr.write(`[fund-data-mcp] ${err}\n`)
        if (msg.id !== undefined) {
          errResult(msg.id ?? null, -32603, err instanceof Error ? err.message : String(err))
        }
      })
    }
  })
  process.stdin.on("end", () => process.exit(0))
  process.stdin.resume()
}

void main()
