import { NextResponse } from "next/server"
import { requireFundDataApiUser } from "@/lib/server/fund-data-auth"
import { handleFundDataMcpRpc, type McpJsonRpc } from "@/lib/server/fund-data-mcp"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Session-Id, x-api-key, Authorization",
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function GET(req: Request) {
  const auth = await requireFundDataApiUser(req)
  if (!auth.ok) {
    return NextResponse.json(auth.body, { status: auth.status, headers: CORS })
  }
  return NextResponse.json(
    {
      name: "fund-data",
      version: "1.0.0",
      transport: "mcp",
      usage: "POST JSON-RPC 2.0 with header x-api-key",
    },
    { headers: CORS },
  )
}

export async function POST(req: Request) {
  const auth = await requireFundDataApiUser(req)
  if (!auth.ok) {
    return NextResponse.json(auth.body, { status: auth.status, headers: CORS })
  }

  let msg: McpJsonRpc
  try {
    msg = (await req.json()) as McpJsonRpc
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400, headers: CORS },
    )
  }

  const reply = await handleFundDataMcpRpc(msg)
  if (reply == null) {
    return new NextResponse(null, { status: 202, headers: CORS })
  }
  return NextResponse.json(reply, { headers: CORS })
}
