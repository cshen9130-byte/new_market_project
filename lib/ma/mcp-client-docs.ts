import { FUND_DATA_HTTPS_MCP_URL } from "@/lib/ma/fund-data-public"
import { MOM_DATA_HTTPS_MCP_URL } from "@/lib/ma/mom-data-public"

export type McpClientKind = "fund" | "mom"

export function mcpClientTarget(kind: McpClientKind) {
  const mom = kind === "mom"
  return {
    id: mom ? "mom-data" : "fund-data",
    label: mom ? "MA MOM数据" : "MA 基金数据",
    url: mom ? MOM_DATA_HTTPS_MCP_URL : FUND_DATA_HTTPS_MCP_URL,
    keyName: mom ? "MOM API Key（mk_ 开头）" : "基金数据 API Key（mf_ 开头）",
  }
}

export function cursorMcpJson(kind: McpClientKind, apiKey: string): string {
  const target = mcpClientTarget(kind)
  return `{
  "mcpServers": {
    "${target.id}": {
      "url": "${target.url}",
      "headers": { "x-api-key": "${apiKey}" }
    }
  }
}`
}

export function codexMcpToml(kind: McpClientKind, apiKey: string): string {
  const target = mcpClientTarget(kind)
  return `[mcp_servers.${target.id}]
url = "${target.url}"

[mcp_servers.${target.id}.http_headers]
x-api-key = "${apiKey}"`
}

export function claudeCodeCommand(kind: McpClientKind, apiKey: string): string {
  const target = mcpClientTarget(kind)
  return `claude mcp add --transport http ${target.id} ${target.url} --header "x-api-key: ${apiKey}"`
}

/** Markdown for the downloadable API guide. WorkBuddy stays in its own section. */
export function buildMcpClientsMarkdown(kind: McpClientKind, apiKey: string): string {
  const target = mcpClientTarget(kind)
  return `远程 MCP 地址用 HTTPS：\`${target.url}\`。HTTP 会被 nginx 301 转到 HTTPS，客户端会把 POST 改成 GET，连接失败。每个同事填自己的 ${target.keyName}，不要写进共享仓库。

### Cursor

1. 打开 Cursor Settings → MCP，或编辑本机 \`~/.cursor/mcp.json\`（Windows 是 \`%USERPROFILE%\\.cursor\\mcp.json\`）。只给当前项目用时，写到项目里的 \`.cursor/mcp.json\`。
2. 把下面的 JSON 贴进去。
3. 保存后在 MCP 列表里打开开关。

\`\`\`json
${cursorMcpJson(kind, apiKey)}
\`\`\`

### 豆包

豆包电脑版左侧进入「技能 · 连接器 · 伙伴」（有的版本写成「插件 · 技能 · 伙伴」）。右上角「新建」→「新建自定义连接器」：

| 项 | 填写 |
| --- | --- |
| 服务器名称 | ${target.label} |
| 传输类型 | HTTP |
| 服务器 URL | \`${target.url}\` |
| 自定义 Headers | 名称 \`x-api-key\`，值填自己的 ${target.keyName} |

保存后打开该连接器的开关，新对话里直接提问。入口名称会随版本变化，在左侧找「连接器」即可。

### Codex

Codex CLI、Codex IDE 插件和 ChatGPT 桌面版共用 \`~/.codex/config.toml\`。只给当前项目用时，写到 \`.codex/config.toml\`。

\`\`\`bash
codex mcp add ${target.id} --url ${target.url}
\`\`\`

这条命令只写入地址。再把请求头补进配置：

\`\`\`toml
${codexMcpToml(kind, apiKey)}
\`\`\`

\`codex mcp list\` 里这一项的 Auth 可能显示 Unsupported。请求头仍然会带上，用 \`codex mcp get ${target.id}\` 能看到 \`http_headers\`。

### Claude

Claude Code：

\`\`\`bash
${claudeCodeCommand(kind, apiKey)}
\`\`\`

Claude Desktop：Settings → Connectors → Add custom connector。URL 填上面的 HTTPS 地址，自定义 Header 名称 \`x-api-key\`。也可以把 Cursor 那份 JSON 放进 \`claude_desktop_config.json\` 的 \`mcpServers\`。
`
}
