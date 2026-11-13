import {
  FUND_DATA_HTTPS_MCP_URL,
  FUND_DATA_MCP_URL,
  FUND_DATA_PUBLIC_HTTPS_ORIGIN,
  FUND_DATA_PUBLIC_ORIGIN,
} from "@/lib/ma/fund-data-public"
import {
  MOM_DATA_HTTPS_MCP_URL,
  MOM_DATA_MCP_URL,
  MOM_DATA_PUBLIC_HTTPS_ORIGIN,
  MOM_DATA_PUBLIC_ORIGIN,
} from "@/lib/ma/mom-data-public"

export type WorkBuddyGuideKind = "fund" | "mom"

export function workbuddyMcpUrl(kind: WorkBuddyGuideKind, protocol: "https" | "http" = "https"): string {
  if (kind === "mom") return protocol === "https" ? MOM_DATA_HTTPS_MCP_URL : MOM_DATA_MCP_URL
  return protocol === "https" ? FUND_DATA_HTTPS_MCP_URL : FUND_DATA_MCP_URL
}

export function workbuddyOrigin(kind: WorkBuddyGuideKind, protocol: "https" | "http" = "https"): string {
  if (kind === "mom") return protocol === "https" ? MOM_DATA_PUBLIC_HTTPS_ORIGIN : MOM_DATA_PUBLIC_ORIGIN
  return protocol === "https" ? FUND_DATA_PUBLIC_HTTPS_ORIGIN : FUND_DATA_PUBLIC_ORIGIN
}

/** Shared WorkBuddy section for on-page docs and the downloadable AI markdown. */
export function buildWorkBuddyGuideMarkdown(kind: WorkBuddyGuideKind): string {
  const name = kind === "mom" ? "MOM 数据" : "基金数据"
  const other = kind === "mom" ? "基金数据" : "MOM 数据"
  const httpsMcp = workbuddyMcpUrl(kind, "https")
  const httpsOrigin = workbuddyOrigin(kind, "https")
  const httpOrigin = workbuddyOrigin(kind, "http")
  const keyPlace = kind === "mom" ? "设置 → MOM数据API" : "用户中心"
  const connectorName = kind === "mom" ? "MA MOM数据" : "MA 基金数据"
  const otherConnector = kind === "mom" ? "MA 基金数据" : "MA MOM数据"
  const otherMcp = workbuddyMcpUrl(kind === "mom" ? "fund" : "mom", "https")
  const keyName = kind === "mom" ? "MOM API Key（mk_ 开头）" : "基金数据 API Key（mf_ 开头）"
  const resourcePath = kind === "mom" ? "mom-data" : "fund-data"
  const permissionNote =
    kind === "mom"
      ? "账户必须已开通「MOM数据API」，否则授权后调用会被 403。管理员账号默认可用。"
      : "AI 研究员、知识库、跟踪池、在管产品等内部工具，仍按该账户在网站上的勾选开放。"
  const prompts =
    kind === "mom"
      ? [
          "列出我能看到的 MOM 账户，并给出每个账户最近一天的权益和保证金使用率。",
          "查看国泰君安期货 85121150 最近一个月的复权净值。",
          "用入库数据计算这个账号今年以来的夏普、最大回撤和 95% 历史 VaR。",
        ]
      : [
          "查一下 SR6089 的基本信息和今年以来净值。",
          "对比这两只基金今年的收益和回撤，策略评论只引用投资笔记里点名它们的段落。",
          "根据知识库，某人在路演里看多或看空哪些品种？每条结论都要带原文、文件路径和页码。",
        ]

  return `### WorkBuddy（推荐：MCP OAuth 登录）

[WorkBuddy](https://www.workbuddy.cn) 用自定义连接器接入本系统的 MCP。每个同事必须用**自己的 MA 系统账号**完成授权，调用范围与该账号在网站上的页面权限相同。不要把本文里的 API Key 填进团队空间、技能或专家，也不要把自己的 Key 发给同事。

生产环境的默认文档地址仍是 HTTP：\`${httpOrigin}\`。同一台服务器同时提供 HTTPS：\`${httpsOrigin}\`（Let's Encrypt 证书，浏览器可校验）。在 WorkBuddy 里添加连接器时，MCP 地址必须用 HTTPS。HTTP 会被 nginx 301 转到 HTTPS，客户端会把 POST 改成 GET，于是读到的不是 JSON-RPC 响应。

#### 推荐方式：自定义连接器 + MCP OAuth 2.1

1. 打开 WorkBuddy，左侧边栏进入「专家·技能·连接器」，选中「连接器」页签。
2. 点击右上角「自定义连接器」。
3. 填写显示名称，例如「${connectorName}」。认证方式选择 **MCP OAuth 2.1**。不必填写 Client ID 或 Secret，系统会按 OAuth 标准自动发现授权地址并注册客户端。
4. MCP Server URL 填写：
   \`${httpsMcp}\`
   Transport 选择 **http（Streamable HTTP，默认）**，不要选 SSE。不要填 HTTP 地址。
5. 保存后，在连接器卡片上点击「+」连接，或在对话里需要用到时点击输入框上方的连接引导卡片。
6. 浏览器会打开本系统的登录/授权页。用**你自己的**网站账号（邮箱或用户名 + 密码）登录，确认后点击「允许授权」。不要用同事的账号。
7. 回到 WorkBuddy，连接器出现绿色圆点后即可用自然语言提问。

授权成功后，WorkBuddy 只保存本系统签发给**当前登录用户**的访问令牌。MCP 的 \`tools/list\` 只会列出该账户有权限的工具；没有对应页面权限时工具不会出现，直接调用也会被拒绝。权限与网站设置里为该账户勾选的页面权限一致。管理员账号默认拥有全部权限。

${name} 和 ${other} 是两个独立的 MCP，需要各建一个连接器，并分别完成一次登录授权。另一个连接器的名称建议用「${otherConnector}」，MCP 地址为 \`${otherMcp}\`。两套令牌都会绑定到同一个 MA 账户，但各自只适用于对应的 API。${permissionNote}

OAuth 相关地址（通常不必手填，WorkBuddy 会从 MCP 地址自动发现）：

| 项 | 地址 |
| --- | --- |
| 授权 | \`${httpsOrigin}/oauth/authorize\` |
| 令牌 | \`${httpsOrigin}/oauth/token\` |
| 动态注册 | \`${httpsOrigin}/oauth/register\` |
| 用户信息 | \`${httpsOrigin}/oauth/userinfo\` |
| 授权服务器元数据 | \`${httpsOrigin}/.well-known/oauth-authorization-server\` |
| 受保护资源元数据 | \`${httpsOrigin}/.well-known/oauth-protected-resource/ma/api/${resourcePath}/mcp\` |

若选择「OAuth 2.0（授权码）」而不是 MCP OAuth 2.1，把上表的授权、令牌、用户信息地址填进去，Redirect URL 用 WorkBuddy 页面底部给出的回调地址。仍须使用 PKCE。Scopes 可填 \`mcp\`。User Info Name Path 填 \`name\`。

#### 备选方式：每个用户自己填写 API Key

如果暂时无法使用 OAuth，可在自定义连接器里选择 **API Key**：

- Key 字段名（Header Name）保持 \`X-API-Key\`（默认即可）。
- 将「作为 MCP Server」打开，MCP Server URL 同上。
- 每个同事连接时，自己到本系统「${keyPlace}」查看或生成 **自己的** ${keyName}，填到连接器的 Header 值里。
- 基金数据 Key 不能用于 MOM 连接器，MOM Key 也不能用于基金数据连接器。
- **禁止**把别人的 Key 写进技能、专家、团队空间或共享文档。

#### 第一次调用时还没连接

技能和专家不会代为登录，也不会编造数据。若连接器未授权，或授权已过期，请停下来提醒用户点击 WorkBuddy 输入框上方的连接卡片，用自己的 MA 账号完成登录。不要改用其他人口述或写在文档里的 Key 继续调用。

#### 可以这样问

- ${prompts[0]}
- ${prompts[1]}
- ${prompts[2]}

更完整的团队空间、技能和专家导入步骤，见仓库 \`docs/workbuddy/README.md\`。
`
}
