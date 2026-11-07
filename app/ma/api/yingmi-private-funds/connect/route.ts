import { NextResponse } from "next/server"
import { isAdmin } from "@/lib/permissions"
import type { User } from "@/lib/auth"
import { getRequestUser } from "@/lib/server/users"
import { createPkce, registerYingmiClient, yingmiAuthorizeUrl, yingmiRedirectUri } from "@/lib/server/yingmi-mcp"
import { saveOauthPending } from "@/lib/server/yingmi-private-fund-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const user = await getRequestUser(req)
  if (!isAdmin(user as User | null)) {
    return NextResponse.json({ error: "仅管理员可连接盈米账号" }, { status: 403 })
  }
  try {
    const redirectUri = yingmiRedirectUri(req)
    const clientId = await registerYingmiClient(redirectUri)
    const pkce = createPkce()
    await saveOauthPending({
      state: pkce.state,
      clientId,
      codeVerifier: pkce.verifier,
      redirectUri,
    })
    return NextResponse.json({
      url: yingmiAuthorizeUrl({
        clientId,
        redirectUri,
        state: pkce.state,
        codeChallenge: pkce.challenge,
      }),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[yingmi-private-funds/connect]", err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
