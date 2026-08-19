import { NextResponse } from "next/server"

export function ctpMarketBaseUrl() {
  return (process.env.CTP_MARKET_URL || "http://127.0.0.1:8000").replace(/\/$/, "")
}

export async function proxyCtpMarket(path: string) {
  const url = `${ctpMarketBaseUrl()}${path}`
  try {
    const res = await fetch(url, { cache: "no-store" })
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `CTP 行情服务返回 ${res.status}` },
        { status: 502 },
      )
    }
    const data = await res.json()
    return NextResponse.json({ ok: true, ...data })
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "CTP 行情服务未启动。请在 ctp_market 目录运行 python server.py（默认 http://127.0.0.1:8000）",
      },
      { status: 503 },
    )
  }
}
