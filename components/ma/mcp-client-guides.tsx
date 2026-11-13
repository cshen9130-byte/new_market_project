"use client"

import { useState } from "react"
import { copyTextToClipboard } from "@/lib/copy-text"
import {
  claudeCodeCommand,
  codexMcpToml,
  cursorMcpJson,
  mcpClientTarget,
  type McpClientKind,
} from "@/lib/ma/mcp-client-docs"

function CodeBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="relative group">
      <pre className="scrollbar-subtle text-xs bg-muted/30 border border-zinc-200/80 dark:border-zinc-700/80 rounded-lg px-3 py-2 overflow-x-auto whitespace-pre font-mono text-zinc-600 dark:text-zinc-300">
        {text}
      </pre>
      <button
        type="button"
        className="absolute top-2 right-2 text-[11px] px-2 py-0.5 border rounded bg-background/90 hover:bg-muted"
        onClick={() => {
          void copyTextToClipboard(text).then((ok) => {
            if (!ok) return
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1200)
          })
        }}
      >
        {copied ? "已复制" : "复制"}
      </button>
    </div>
  )
}

export function McpClientGuides({ kind, apiKey }: { kind: McpClientKind; apiKey: string }) {
  const target = mcpClientTarget(kind)
  return (
    <div className="mt-4 space-y-6">
      <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
        远程 MCP 地址用 HTTPS：<code className="font-mono text-xs">{target.url}</code>。
        HTTP 会被 nginx 301 转到 HTTPS，客户端会把 POST 改成 GET，连接失败。
        每个同事填自己的 {target.keyName}，不要写进共享仓库。
      </p>

      <div>
        <h4 id="mcp-cursor" className="text-sm font-medium text-zinc-800 dark:text-zinc-100 scroll-mt-6">Cursor</h4>
        <ol className="mt-2 text-sm text-zinc-500 dark:text-zinc-400 space-y-1.5 list-decimal pl-5 leading-relaxed">
          <li>打开 Cursor Settings → MCP，或编辑本机 <code className="font-mono text-xs">~/.cursor/mcp.json</code>（Windows 是 <code className="font-mono text-xs">%USERPROFILE%\.cursor\mcp.json</code>）。只给当前项目用时，写到项目里的 <code className="font-mono text-xs">.cursor/mcp.json</code>。</li>
          <li>把下面的 JSON 贴进去。</li>
          <li>保存后在 MCP 列表里打开开关。</li>
        </ol>
        <div className="mt-2">
          <CodeBlock text={cursorMcpJson(kind, apiKey)} />
        </div>
      </div>

      <div>
        <h4 id="mcp-doubao" className="text-sm font-medium text-zinc-800 dark:text-zinc-100 scroll-mt-6">豆包</h4>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
          豆包电脑版左侧进入「技能 · 连接器 · 伙伴」（有的版本写成「插件 · 技能 · 伙伴」）。右上角「新建」→「新建自定义连接器」。
        </p>
        <ul className="mt-2 text-sm text-zinc-500 dark:text-zinc-400 space-y-1 list-disc pl-5 leading-relaxed">
          <li>服务器名称：{target.label}</li>
          <li>传输类型：HTTP</li>
          <li>服务器 URL：<code className="font-mono text-xs">{target.url}</code></li>
          <li>自定义 Headers：名称 <code className="font-mono text-xs">x-api-key</code>，值填自己的 {target.keyName}</li>
        </ul>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
          保存后打开该连接器的开关，新对话里直接提问。入口名称会随版本变化，在左侧找「连接器」即可。
        </p>
      </div>

      <div>
        <h4 id="mcp-codex" className="text-sm font-medium text-zinc-800 dark:text-zinc-100 scroll-mt-6">Codex</h4>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
          Codex CLI、Codex IDE 插件和 ChatGPT 桌面版共用 <code className="font-mono text-xs">~/.codex/config.toml</code>。只给当前项目用时，写到 <code className="font-mono text-xs">.codex/config.toml</code>。
        </p>
        <div className="mt-2">
          <CodeBlock text={`codex mcp add ${target.id} --url ${target.url}`} />
        </div>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
          这条命令只写入地址。再把请求头补进配置。
        </p>
        <div className="mt-2">
          <CodeBlock text={codexMcpToml(kind, apiKey)} />
        </div>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
          <code className="font-mono text-xs">codex mcp list</code> 里这一项的 Auth 可能显示 Unsupported。请求头仍然会带上，用 <code className="font-mono text-xs">codex mcp get {target.id}</code> 能看到 <code className="font-mono text-xs">http_headers</code>。
        </p>
      </div>

      <div>
        <h4 id="mcp-claude" className="text-sm font-medium text-zinc-800 dark:text-zinc-100 scroll-mt-6">Claude</h4>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">Claude Code：</p>
        <div className="mt-2">
          <CodeBlock text={claudeCodeCommand(kind, apiKey)} />
        </div>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
          Claude Desktop：Settings → Connectors → Add custom connector。URL 填上面的 HTTPS 地址，自定义 Header 名称 <code className="font-mono text-xs">x-api-key</code>。也可以把 Cursor 那份 JSON 放进 <code className="font-mono text-xs">claude_desktop_config.json</code> 的 <code className="font-mono text-xs">mcpServers</code>。
        </p>
      </div>
    </div>
  )
}
