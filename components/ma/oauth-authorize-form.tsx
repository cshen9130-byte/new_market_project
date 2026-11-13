"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Eye, EyeOff } from "lucide-react"

type Props = {
  queryString: string
  clientName: string
  resourceLabel: string
  resourceUrl: string | null
  user: { id: string; name: string; email: string } | null
  momWarning: string | null
}

export function OAuthAuthorizeForm({
  queryString,
  clientName,
  resourceLabel,
  resourceUrl,
  user,
  momWarning,
}: Props) {
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">把本系统的访问权限授予 {clientName || "WorkBuddy"}</h1>
      <p className="text-sm text-zinc-600 leading-relaxed">
        首次连接时请使用<strong>你自己的 MA 系统账号</strong>登录。授权成功后，{clientName || "该应用"} 将以你的身份调用
        {resourceLabel}，可见范围与你在本网站的页面权限相同。不要使用同事的账号或 API Key。
      </p>
      {resourceUrl ? (
        <p className="text-xs text-zinc-400 break-all">资源：{resourceUrl}</p>
      ) : null}
      {momWarning ? (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">{momWarning}</p>
      ) : null}
      {error ? (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>
      ) : null}

      {user ? (
        <div className="space-y-4">
          <div className="rounded-md border bg-zinc-50 px-3 py-2 text-sm">
            当前登录：<span className="font-medium">{user.name}</span>
            <span className="text-zinc-500">（{user.email}）</span>
          </div>
          <form action="/oauth/authorize/decide" method="post" className="space-y-3" onSubmit={() => setBusy(true)}>
            <input type="hidden" name="decision" value="allow" />
            <QueryFields queryString={queryString} />
            <div className="flex gap-3">
              <Button type="submit" className="flex-1" disabled={busy}>
                {busy ? "处理中…" : "允许授权"}
              </Button>
              <Button type="submit" name="decision" value="deny" variant="outline" disabled={busy}>
                拒绝
              </Button>
            </div>
          </form>
          <form action="/oauth/authorize/logout" method="post">
            <QueryFields queryString={queryString} />
            <button type="submit" className="text-xs text-zinc-500 hover:text-zinc-800 underline">
              换一个账号登录
            </button>
          </form>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault()
            setBusy(true)
            setError("")
            const form = event.currentTarget
            const body = new FormData(form)
            const response = await fetch("/oauth/authorize/login", {
              method: "POST",
              body,
              headers: { Accept: "application/json" },
            })
            const data = (await response.json().catch(() => ({}))) as { error?: string; next?: string; ok?: boolean }
            if (response.ok && data.ok) {
              window.location.assign(data.next || `/oauth/authorize?${queryString}`)
              return
            }
            setError(data.error || "登录失败，请检查账号和密码")
            setBusy(false)
          }}
        >
          <QueryFields queryString={queryString} />
          <div className="space-y-1.5">
            <Label htmlFor="oauth-identifier">邮箱或账号</Label>
            <Input id="oauth-identifier" name="identifier" autoComplete="username" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="oauth-password">密码</Label>
            <div className="relative">
              <Input
                id="oauth-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                className="pr-10"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "登录中…" : "登录并继续"}
          </Button>
        </form>
      )}
    </div>
  )
}

function QueryFields({ queryString }: { queryString: string }) {
  const params = new URLSearchParams(queryString)
  return (
    <>
      {Array.from(params.entries()).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
    </>
  )
}
