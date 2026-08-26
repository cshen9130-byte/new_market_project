import { ctpMarketBaseUrl, ctpMarketWsUrl } from "@/lib/server/ctp-market-proxy"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

const encoder = new TextEncoder()

function sseChunk(payload: unknown) {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
}

async function liveSnapshot() {
  const res = await fetch(`${ctpMarketBaseUrl()}/api/live`, { cache: "no-store" })
  if (!res.ok) throw new Error(`CTP 行情服务返回 ${res.status}`)
  return res.json()
}

export async function GET(request: Request) {
  const stream = new ReadableStream({
    start(controller) {
      let closed = false
      let polling = false
      let ws: WebSocket | null = null
      let ping: ReturnType<typeof setInterval> | undefined
      let poll: ReturnType<typeof setTimeout> | undefined

      const send = (payload: unknown) => {
        if (closed) return
        try {
          controller.enqueue(sseChunk(payload))
        } catch {
          cleanup()
        }
      }

      const cleanup = () => {
        if (closed) return
        closed = true
        if (ping) clearInterval(ping)
        if (poll) clearTimeout(poll)
        try {
          ws?.close()
        } catch {
          // already closed
        }
        ws = null
        try {
          controller.close()
        } catch {
          // already closed
        }
      }

      const startPoll = () => {
        if (polling || closed) return
        polling = true
        const tick = async () => {
          if (closed) return
          try {
            send({ type: "snapshot", ...(await liveSnapshot()) })
          } catch {
            // keep the stream; client still has the last tick
          }
          if (!closed) poll = setTimeout(tick, 80)
        }
        void tick()
      }

      ping = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`))
        } catch {
          cleanup()
        }
      }, 15_000)

      void (async () => {
        try {
          send({ type: "snapshot", ...(await liveSnapshot()) })
        } catch (err) {
          send({
            type: "error",
            error: err instanceof Error ? err.message : "CTP 行情服务不可用",
          })
          cleanup()
          return
        }

        const WS = globalThis.WebSocket
        if (!WS) {
          startPoll()
          return
        }

                        try {
          ws = new WS(ctpMarketWsUrl())
          ws.onmessage = (event) => {
            const raw = typeof event.data === "string" ? event.data : ""
            if (!raw) return
            try {
              send(JSON.parse(raw))
            } catch {
              // ignore malformed frames
            }
          }
          ws.onclose = () => {
            if (!closed) startPoll()
          }
          ws.onerror = () => {
            try {
              ws?.close()
            } catch {
              // ignore
            }
          }
        } catch {
          startPoll()
        }
      })()

      request.signal.addEventListener("abort", cleanup)
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
