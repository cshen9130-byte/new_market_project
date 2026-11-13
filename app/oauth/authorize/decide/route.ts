import { NextResponse } from "next/server"
import {
  denyAuthorizeRedirect,
  issueAuthorizationCode,
  originFromRequest,
  prepareAuthorize,
  readAuthorizeInput,
  sessionFromRequest,
} from "@/lib/server/mcp-oauth"
import { getMcpOAuthStore } from "@/lib/server/mcp-oauth-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const form = await req.formData()
  const prepared = await prepareAuthorize(getMcpOAuthStore(), readAuthorizeInput(form))
  if (!prepared.ok) {
    if (prepared.redirectTo) return NextResponse.redirect(prepared.redirectTo, 303)
    return NextResponse.json({ error: prepared.description }, { status: prepared.status })
  }
  const session = sessionFromRequest(req)
  if (!session) {
    const back = new URL(`/oauth/authorize?${hiddenQuery(form)}`, originFromRequest(req)).toString()
    return NextResponse.redirect(back, 303)
  }
  const decision = String(form.get("decision") || "deny")
  if (decision !== "allow") {
    return NextResponse.redirect(denyAuthorizeRedirect(prepared.request), 303)
  }
  const redirectTo = await issueAuthorizationCode(getMcpOAuthStore(), prepared.request, session.uid)
  return NextResponse.redirect(redirectTo, 303)
}

function hiddenQuery(form: FormData): string {
  const params = new URLSearchParams()
  for (const [key, value] of form.entries()) {
    if (key === "decision" || key === "identifier" || key === "password") continue
    params.set(key, String(value))
  }
  return params.toString()
}
