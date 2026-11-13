"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { authService } from "@/lib/auth"
import { copyTextToClipboard } from "@/lib/copy-text"
import { buildWorkBuddyMcpConfig } from "@/lib/ma/workbuddy-mcp-config"
import { canAccessMomDataApi } from "@/lib/permissions"

export function WorkBuddyConnectorPanel() {
  const [fundKey, setFundKey] = useState("")
  const [momKey, setMomKey] = useState("")
  const [momAccess, setMomAccess] = useState(false)
  const [ready, setReady] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    void authService.refreshCurrentUser().then((user) => {
      if (cancelled) return
      setFundKey(user?.api_key || "")
      setMomKey(user?.mom_api_key || "")
      setMomAccess(canAccessMomDataApi(user))
      setReady(true)
    })
    return () => { cancelled = true }
  }, [])

  const config = buildWorkBuddyMcpConfig({ fundApiKey: fundKey, momApiKey: momKey, momAccess })
  const hasFund = Boolean(fundKey.trim())
  const hasMom = momAccess && Boolean(momKey.trim())

  return (
    <div className="max-w-4xl">
      <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-200 mb-2">WorkBuddy连接器</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
        打开 WorkBuddy 的「MCP 服务管理」，点「+ 添加 MCP」，用下面整段替换编辑器内容，再点保存。
        只开通了基金数据 API 时，这里只有 <code className="font-mono text-xs">fund-data</code>。
        同时开通了 MOM数据API 时，两段写在同一份配置里。
        这段含你自己的 Key，只贴进自己的 WorkBuddy。
      </p>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed mt-2">
        若 <code className="font-mono text-xs">mcp.json</code> 里已经有别的服务，只把这里的服务加进 <code className="font-mono text-xs">mcpServers</code>，不要整份覆盖。
      </p>

      {!ready ? (
        <p className="mt-6 text-sm text-zinc-400">正在读取当前账户的 Key…</p>
      ) : (
        <>
          {!hasFund ? (
            <p className="mt-4 text-sm text-zinc-500">
              还没有基金数据 API Key。到<Link className="text-red-500 hover:underline" href="/ma/dashboard/settings?section=user-center">用户中心</Link>查看或生成后再复制。
            </p>
          ) : null}
          {momAccess && !hasMom ? (
            <p className="mt-4 text-sm text-zinc-500">
              当前账户已开通 MOM数据API，但还没有 MOM Key。到<Link className="text-red-500 hover:underline" href="/ma/dashboard/settings?section=mom-data-api">MOM数据API</Link>生成后，这里会把两段放在一起。
            </p>
          ) : null}
          {hasFund || hasMom ? (
            <div className="relative mt-4">
              <pre className="text-xs bg-muted/40 border rounded-lg p-3 overflow-x-auto whitespace-pre font-mono text-zinc-700 dark:text-zinc-300">
                {config}
              </pre>
              <button
                type="button"
                className="absolute top-2 right-2 text-[11px] px-2 py-0.5 border rounded bg-background/90 hover:bg-muted"
                onClick={() => {
                  void copyTextToClipboard(config).then((ok) => {
                    if (!ok) return
                    setCopied(true)
                    window.setTimeout(() => setCopied(false), 1200)
                  })
                }}
              >
                {copied ? "已复制" : "复制"}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
