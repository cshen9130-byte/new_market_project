import { NextResponse } from "next/server"
import {
  originFromRequest,
  prepareAuthorize,
  readAuthorizeInput,
  requestIsHttps,
  sessionCookieHeader,
  signSession,
} from "@/lib/server/mcp-oauth"
import { getMcpOAuthStore } from "@/lib/server/mcp-oauth-store"
import { verifyLogin } from "@/lib/server/users"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const form = await req.formData()
  const identifier = String(form.get("identifier") || "").trim()
  const password = String(form.get("password") || "")
  const prepared = await prepareAuthorize(getMcpOAuthStore(), readAuthorizeInput(form))
  const returnPath = `/oauth/authorize?${new URL(req.url).searchParams.toString() || hiddenQuery(form)}`
  const accept = req.headers.get("accept") || ""
  const wantsJson = accept.includes("application/json") || req.headers.get("x-requested-with") === "fetch"

  if (!identifier || !password) {
    return errorResponse("请输入账号和密码", wantsJson, returnPath)
  }
  if (!prepared.ok) {
    return errorResponse(prepared.description, wantsJson, returnPath, prepared.status)
  }
  const user = await verifyLogin(identifier, password)
  if (!user) {
    return errorResponse("账号或密码错误", wantsJson, returnPath, 401)
  }
  const https = requestIsHttps(req)
  const location = new URL(returnPath, originFromRequest(req)).toString()
  const response = wantsJson
    ? NextResponse.json({ ok: true, next: returnPath })
    : NextResponse.redirect(location, 303)
  response.headers.append("Set-Cookie", sessionCookieHeader(signSession(user.id), https))
  if (wantsJson) response.headers.set("Location", returnPath)
  return response
}

function hiddenQuery(form: FormData): string {
  const params = new URLSearchParams()
  for (const [key, value] of form.entries()) {
    if (key === "identifier" || key === "password") continue
    params.set(key, String(value))
  }
  return params.toString()
}

function errorResponse(message: string, wantsJson: boolean, returnPath: string, status = 400) {
  if (wantsJson) return NextResponse.json({ error: message }, { status })
  const url = `${returnPath}${returnPath.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`
  return NextResponse.redirect(url, 303)
}
