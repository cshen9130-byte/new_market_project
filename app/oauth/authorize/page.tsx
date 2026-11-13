import { OAuthAuthorizeForm } from "@/components/ma/oauth-authorize-form"
import { prepareAuthorize, readAuthorizeInput, sessionFromRequest } from "@/lib/server/mcp-oauth"
import { getMcpOAuthStore } from "@/lib/server/mcp-oauth-store"
import { getUserById } from "@/lib/server/users"
import { canAccessMomDataApi } from "@/lib/permissions"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function familyLabel(family: string) {
  if (family === "mom-data") return "MOM 数据 MCP"
  if (family === "fund-data") return "基金数据 MCP"
  return "基金数据与 MOM 数据 MCP"
}

export default async function OAuthAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const raw = await searchParams
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) {
      if (value[0] != null) params.set(key, value[0])
    } else if (value != null) {
      params.set(key, value)
    }
  }

  const prepared = await prepareAuthorize(getMcpOAuthStore(), readAuthorizeInput(params))
  if (!prepared.ok) {
    if (prepared.redirectTo) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-zinc-50 px-4">
          <meta httpEquiv="refresh" content={`0;url=${prepared.redirectTo}`} />
          <p className="text-sm text-zinc-500">正在返回应用…</p>
        </div>
      )
    }
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-zinc-900">无法完成授权</h1>
        <p className="mt-2 text-sm text-zinc-600">{prepared.description}</p>
      </Shell>
    )
  }

  const { headers } = await import("next/headers")
  const headerList = await headers()
  const cookie = headerList.get("cookie")
  const fakeReq = new Request("http://localhost/oauth/authorize", { headers: cookie ? { cookie } : {} })
  const session = sessionFromRequest(fakeReq)
  const user = session ? await getUserById(session.uid) : null
  const momWarning =
    prepared.request.family === "mom-data" && user && !canAccessMomDataApi(user)
      ? "当前账户尚未开通「MOM数据API」。授权后连接器会登录成功，但调用 MOM 工具时会被拒绝。请联系管理员开通后再使用。"
      : null

  const qs = params.toString()
  return (
    <Shell>
      <OAuthAuthorizeForm
        queryString={qs}
        clientName={prepared.request.client.clientName}
        resourceLabel={familyLabel(prepared.request.family)}
        resourceUrl={prepared.request.resource}
        user={user ? { id: user.id, name: user.name, email: user.email } : null}
        momWarning={momWarning}
      />
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-red-500 mb-4">MA 系统授权</p>
        {children}
      </div>
    </div>
  )
}
