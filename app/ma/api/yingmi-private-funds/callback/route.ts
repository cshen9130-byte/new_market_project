import { NextResponse } from "next/server"
import { exchangeYingmiCode, requestOrigin } from "@/lib/server/yingmi-mcp"
import { saveYingmiCredential, takeOauthPending } from "@/lib/server/yingmi-private-fund-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const origin = requestOrigin(req)
  const back = (query: string) =>
    NextResponse.redirect(`${origin}/ma/dashboard/private-funds?tab=investment&side=inv-tracking&rank_source=yingmi&${query}`)
  const oauthError = url.searchParams.get("error")
  if (oauthError) return back(`yingmi=error&yingmi_error=${encodeURIComponent(oauthError)}`)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  if (!code || !state) return back("yingmi=error&yingmi_error=missing_code")
  try {
    const pending = await takeOauthPending(state)
    if (!pending) return back("yingmi=error&yingmi_error=state_expired")
    const token = await exchangeYingmiCode({
      clientId: pending.clientId,
      code,
      redirectUri: pending.redirectUri,
      codeVerifier: pending.codeVerifier,
    })
    if (!token.refreshToken) return back("yingmi=error&yingmi_error=no_refresh_token")
    await saveYingmiCredential(pending.clientId, token.refreshToken)
    return back("yingmi=connected")
  } catch (err) {
    console.error("[yingmi-private-funds/callback]", err)
    return back("yingmi=error&yingmi_error=exchange_failed")
  }
}
