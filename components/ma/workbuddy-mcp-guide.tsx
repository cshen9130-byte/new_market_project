import {
  buildWorkBuddyGuideMarkdown,
  workbuddyMcpUrl,
  workbuddyOrigin,
  type WorkBuddyGuideKind,
} from "@/lib/ma/workbuddy-api-guide"

function CodeBlock({ text }: { text: string }) {
  return (
    <pre className="text-xs font-mono bg-zinc-50 dark:bg-zinc-900 border rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
      {text}
    </pre>
  )
}


function Shot({ src, alt, caption }: { src: string; alt: string; caption: string }) {
  return (
    <figure className="mt-1">
      <img
        src={src}
        alt={alt}
        className="w-full max-w-3xl rounded-lg border border-zinc-200 dark:border-zinc-700"
      />
      <figcaption className="text-xs text-zinc-400 mt-1.5 leading-relaxed">{caption}</figcaption>
    </figure>
  )
}

export function WorkBuddyMcpGuide({ kind }: { kind: WorkBuddyGuideKind }) {
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

  return (
    <div className="mt-6 space-y-3">
      <h4 id="workbuddy" className="text-sm font-medium text-zinc-800 dark:text-zinc-100 scroll-mt-6">WorkBuddy（推荐：MCP OAuth 登录）</h4>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
        <a className="text-red-500 hover:underline" href="https://www.workbuddy.cn" target="_blank" rel="noreferrer">WorkBuddy</a>
        用自定义连接器接入本系统的 MCP。每个同事必须用<strong>自己的 MA 系统账号</strong>完成授权，调用范围与该账号在网站上的页面权限相同。
        不要把本页的 API Key 填进团队空间、技能或专家，也不要把自己的 Key 发给同事。
      </p>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
        生产环境的默认文档地址仍是 HTTP：<code className="font-mono text-xs">{httpOrigin}</code>。
        同一台服务器同时提供 HTTPS：<code className="font-mono text-xs">{httpsOrigin}</code>（Let&apos;s Encrypt 证书，浏览器可校验）。
        在 WorkBuddy 里添加连接器时，MCP 地址必须用 HTTPS。HTTP 会被 nginx 301 转到 HTTPS，客户端会把 POST 改成 GET，于是读到的不是 JSON-RPC 响应。
      </p>

      <p className="text-xs font-medium text-zinc-500">推荐方式：自定义连接器 + MCP OAuth 2.1</p>
      <ol className="text-sm text-zinc-500 dark:text-zinc-400 space-y-2 list-decimal pl-5 leading-relaxed">
        <li>打开 WorkBuddy，左侧边栏进入「专家·技能·连接器」，选中「连接器」页签。</li>
        <li>
          点击右上角「自定义连接器」。若客户端打开的是带「MCP OAuth 2.1」和 MCP URL 的表单，按下面第 3–4 步填写。
          若打开的是「MCP 服务管理」（5.6.2 常见），点「+ 添加 MCP」，把两个 MCP 按客户端格式写进本机 mcp.json 的 <code className="font-mono text-xs">mcpServers</code>，URL 用下面的 HTTPS 地址，不要把 API Key 写进这份配置。
        </li>
        <li>填写显示名称，例如「{connectorName}」。认证方式选择 <strong>MCP OAuth 2.1</strong>。不必填写 Client ID 或 Secret，系统会按 OAuth 标准自动发现授权地址并注册客户端。</li>
        <li>
          MCP Server URL 填写：
          <code className="font-mono text-xs block mt-1">{httpsMcp}</code>
          Transport 选择 <strong>http（Streamable HTTP，默认）</strong>，不要选 SSE。不要填 HTTP 地址。
        </li>
        <li>保存后，在连接器卡片上点击「+」连接，或在对话里需要用到时点击输入框上方的连接引导卡片。</li>
        <li>浏览器会打开本系统的登录/授权页。用<strong>你自己的</strong>网站账号（邮箱或用户名 + 密码）登录，确认后点击「允许授权」。不要用同事的账号。</li>
        <li>回到 WorkBuddy，连接器出现绿色圆点后即可用自然语言提问。</li>
      </ol>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
        授权成功后，WorkBuddy 只保存本系统签发给<strong>当前登录用户</strong>的访问令牌。
        MCP 的 tools/list 只会列出该账户有权限的工具；没有对应页面权限时工具不会出现，直接调用也会被拒绝。
        权限与网站设置里为该账户勾选的页面权限一致。管理员账号默认拥有全部权限。
      </p>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
        {name} 和 {other} 是两个独立的 MCP，需要各建一个连接器，并分别完成一次登录授权。
        另一个连接器的名称建议用「{otherConnector}」，MCP 地址为 <code className="font-mono text-xs">{otherMcp}</code>。
        两套令牌都会绑定到同一个 MA 账户，但各自只适用于对应的 API。{permissionNote}
      </p>
      <p className="text-xs text-zinc-400">OAuth 相关地址（通常不必手填，WorkBuddy 会从 MCP 地址自动发现）</p>
      <CodeBlock
        text={`授权 ${httpsOrigin}/oauth/authorize
令牌 ${httpsOrigin}/oauth/token
动态注册 ${httpsOrigin}/oauth/register
用户信息 ${httpsOrigin}/oauth/userinfo
授权服务器元数据 ${httpsOrigin}/.well-known/oauth-authorization-server
受保护资源元数据 ${httpsOrigin}/.well-known/oauth-protected-resource/ma/api/${resourcePath}/mcp`}
      />
      <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
        若选择「OAuth 2.0（授权码）」而不是 MCP OAuth 2.1，把上面的授权、令牌、用户信息地址填进去，Redirect URL 用 WorkBuddy 页面底部给出的回调地址。仍须使用 PKCE。Scopes 可填 mcp。User Info Name Path 填 name。
      </p>

      <p className="text-xs font-medium text-zinc-500">备选方式：每个用户自己填写 API Key</p>
      <ul className="text-sm text-zinc-500 dark:text-zinc-400 space-y-1 list-disc pl-5 leading-relaxed">
        <li>自定义连接器的认证方式选择 API Key，Key 字段名保持 <code className="font-mono text-xs">X-API-Key</code>。</li>
        <li>将「作为 MCP Server」打开，MCP Server URL 同上。</li>
        <li>每个同事连接时，自己到本系统「{keyPlace}」查看或生成 <strong>自己的</strong> {keyName}，填到连接器的 Header 值里。</li>
        <li>基金数据 Key 不能用于 MOM 连接器，MOM Key 也不能用于基金数据连接器。</li>
        <li><strong>禁止</strong>把别人的 Key 写进技能、专家、团队空间或共享文档。</li>
      </ul>

      <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
        技能和专家不会代为登录，也不会编造数据。若连接器未授权，或授权已过期，请停下来提醒用户点击 WorkBuddy 输入框上方的连接卡片，用自己的 MA 账号完成登录。不要改用其他人口述或写在文档里的 Key 继续调用。
      </p>
      <p className="text-xs text-zinc-400">可以这样问</p>
      <ul className="text-sm text-zinc-500 dark:text-zinc-400 space-y-1 list-disc pl-5">
        {prompts.map((prompt) => <li key={prompt}>{prompt}</li>)}
      </ul>
      <p id="workbuddy-space" className="text-xs font-medium text-zinc-500 scroll-mt-6">团队空间与入口</p>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
        请加入已有的团队空间「MA数据（基金/MOM）」（由管理员邀请），不要把本系统的连接器说明、技能和专家放进「JY团队空间」。
        加入后在资料库中打开该空间。技能和专家在左侧「专家·技能·连接器」里导入，打包文件在仓库 <code className="font-mono text-xs">docs/workbuddy/</code> 下。
      </p>
      <figure className="mt-1">
        <img
          src="/ma/workbuddy/01-library-team-space.png"
          alt="WorkBuddy 资料库：左侧「专家·技能·连接器」用于添加连接器、技能和专家；在团队空间中打开已有的「MA数据（基金/MOM）」"
          className="w-full max-w-3xl rounded-lg border border-zinc-200 dark:border-zinc-700"
        />
        <figcaption className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
          ① 左侧「专家·技能·连接器」：添加自定义连接器、上传技能、创建专家。② 加入后在资料库的团队空间中打开「MA数据（基金/MOM）」。不必自己新建空间。
        </figcaption>
      </figure>
      <Shot
        src="/ma/workbuddy/03-mcp-management.png"
        alt="WorkBuddy 自定义连接器打开的「MCP 服务管理」，右上角是「+ 添加 MCP」"
        caption="专家·技能·连接器 → 连接器 → 自定义连接器。会打开「MCP 服务管理」，点右上角「+ 添加 MCP」添加本系统的两个 MCP。"
      />
      <Shot
        src="/ma/workbuddy/03-add-mcp-json.png"
        alt="「+ 添加 MCP」打开的本机 mcp.json 编辑器，其中 mcpServers 为空对象"
        caption="「+ 添加 MCP」会打开本机 mcp.json 编辑器（没有单独的 OAuth / URL 表单）。把两个 HTTPS MCP 地址按客户端格式写入 mcpServers，不要写入 API Key。"
      />
      <Shot
        src="/ma/workbuddy/04-upload-skill.png"
        alt="WorkBuddy 导入技能对话框，要求 zip 或文件夹内包含 SKILL.md"
        caption="技能页签 → 添加技能 → 上传技能，打开「导入技能」。拖入 docs/workbuddy/skills 下的 zip，根目录必须直接包含 SKILL.md。"
      />
      <Shot
        src="/ma/workbuddy/05-create-expert.png"
        alt="点击「+ 创建专家」后打开的「新建任务」，预填了 @expert-manager 提示词"
        caption="专家页签 → 我的专家 → + 创建专家。会打开「新建任务」并预填 @expert-manager；若客户端提供名称和提示词表单，把 experts 目录里对应的 md 粘贴进去。"
      />
      <p className="text-xs text-zinc-400">
        更完整的团队空间、技能和专家导入步骤，见仓库 docs/workbuddy/README.md。
      </p>
    </div>
  )
}

/** Keep a stable export so the downloadable markdown and this page stay in the same module. */
export function workbuddyGuideForDownload(kind: WorkBuddyGuideKind): string {
  return buildWorkBuddyGuideMarkdown(kind)
}
