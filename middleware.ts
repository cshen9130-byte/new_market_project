import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

function isLocalOrigin(origin: string): boolean {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false
  const host = url.hostname
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true
  const parts = host.split(".")
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return false
  const a = Number(parts[0])
  const b = Number(parts[1])
  if (a === 10 || (a === 192 && b === 168)) return true
  return a === 172 && b >= 16 && b <= 31
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, x-market-user-id, Authorization",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  }
}

export function middleware(request: NextRequest) {
  const origin = request.headers.get("origin")
  if (!origin || !isLocalOrigin(origin)) return NextResponse.next()

  if (request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: corsHeaders(origin) })
  }

  const response = NextResponse.next()
  for (const [key, value] of Object.entries(corsHeaders(origin))) {
    response.headers.set(key, value)
  }
  return response
}

export const config = {
  matcher: ["/api/:path*", "/ma/api/:path*"],
}
