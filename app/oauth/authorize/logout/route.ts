import { NextResponse } from "next/server"
import { clearSessionCookieHeader, originFromRequest, requestIsHttps } from "@/lib/server/mcp-oauth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const form = await req.formData()
  const params = new URLSearchParams()
  for (const [key, value] of form.entries()) params.set(key, String(value))
  const location = new URL(`/oauth/authorize?${params.toString()}`, originFromRequest(req)).toString()
  const response = NextResponse.redirect(location, 303)
  response.headers.append("Set-Cookie", clearSessionCookieHeader(requestIsHttps(req)))
  return response
}
