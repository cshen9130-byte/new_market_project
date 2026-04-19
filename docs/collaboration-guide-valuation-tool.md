# 市场监控看板 — 网站架构介绍与协作开发指引

> 目标：帮助新成员快速理解本项目整体架构，并独立完成  
> **MA 市场监控分析看板（传统风格）> 小工具 > 估值表分析** 新小工具的开发。

---

## 一、技术栈总览

| 层次 | 技术 |
|------|------|
| 框架 | Next.js 16（App Router） |
| 语言 | TypeScript |
| 样式 | Tailwind CSS |
| UI 组件库 | Radix UI（已封装在 `components/ui/`） |
| 图表 | ECharts（`echarts-for-react`）& Recharts |
| 数据库 | PostgreSQL（通过 `lib/db.ts` 的连接池访问） |
| 认证 | 自建 JWT-less Session（`lib/auth.ts` + `lib/server/users.ts`） |
| 包管理 | pnpm |
| 部署 | PM2 + Nginx（见 `ecosystem.config.js` / `deploy/`） |

---

## 二、目录结构速览

```
market_dashboard_website/
├── app/                     # Next.js App Router 路由根目录
│   ├── globals.css          # 全局样式（根级）
│   ├── layout.tsx           # 全局根布局（ThemeProvider、字体）
│   ├── page.tsx             # 根路由（重定向到登录/主页）
│   ├── analysis/            # 分析页面
│   ├── api/                 # 全局公共 API Routes
│   │   ├── auth/            # 登录/注销
│   │   ├── admin/           # 用户管理（admin 权限）
│   │   ├── knowledge-base/  # AI 知识库
│   │   └── db-explorer/     # 数据库浏览器
│   ├── classic/             # 传统首页（已简化）
│   ├── dashboard/           # 赛博风格看板（独立子系统，不在本次范围）
│   ├── login/               # 登录页
│   └── ma/                  # ★ MA 市场监控子系统
│       ├── globals.css      # MA 子系统专属全局样式
│       ├── layout.tsx       # MA 根布局（字体/主题继承）
│       ├── page.tsx         # 重定向到 /ma/dashboard
│       ├── api/             # MA 专属 API Routes
│       │   ├── basis/       # 基差相关
│       │   ├── chat/        # AI 对话
│       │   ├── choice/      # Choice 数据（成交额热力图等）
│       │   ├── futures/     # 期货快照
│       │   ├── macro/       # 宏观指标
│       │   ├── nanhua/      # 南华商品指数
│       │   ├── mom-analysis/
│       │   └── tools/       # 小工具专属 API
│       │       ├── nav-cleaner/
│       │       └── send-email/    # (email-dispatch)
│       ├── dashboard/       # ★ 传统风格看板页面
│       │   ├── layout.tsx   # 带侧边栏+顶部栏的主布局（含鉴权）
│       │   ├── page.tsx     # 总览（市场状态卡片）
│       │   ├── ai-knowledge/    # AI 知识库
│       │   ├── futures-market/  # 期货市场
│       │   ├── macro-market/    # 宏观市场
│       │   ├── mom-analysis/    # MOM 分析（需 mom 权限）
│       │   ├── options-market/  # 期权市场
│       │   ├── private-funds/   # 私募基金
│       │   ├── stock-market/    # 股票市场
│       │   └── tools/           # ★ 小工具集合（新工具加在这里）
│       │       ├── page.tsx         # 小工具入口卡片列表
│       │       ├── nav-cleaner/     # 净值表识别清洗
│       │       └── send-email/      # 自动发邮件
│       └── mom_report/      # MOM 月报静态页面托管
├── components/
│   ├── ui/                  # Radix UI 封装的基础组件（Button/Card/Table 等）
│   ├── ma/                  # MA 看板专属组件
│   │   ├── dashboard-sidebar.tsx  # 左侧导航栏（包含所有导航项配置）
│   │   └── ...
│   ├── dashboard-header.tsx # 顶部栏
│   └── chat-bot-widget.tsx  # AI 对话悬浮窗
├── lib/
│   ├── db.ts                # PostgreSQL 连接池封装
│   ├── auth.ts              # 前端 authService（localStorage + API）
│   └── server/              # 仅服务端逻辑
│       ├── users.ts         # 用户 CRUD（读写 JSON 文件）
│       ├── nav-cleaner.ts   # 净值清洗业务逻辑
│       ├── storage.ts       # 持久化存储路径工具
│       └── email-dispatch.ts
├── hooks/                   # React 自定义 Hook
├── types/                   # 全局 TypeScript 类型定义
├── data/                    # 静态 JSON 数据缓存（兜底/离线用）
└── docs/                    # ← 本文件所在目录
```

---

## 三、路由与认证机制

### 3.1 路由约定（Next.js App Router）

- 每个目录下的 `page.tsx` 对应一个 URL 路由。
- `layout.tsx` 作用于该目录及所有子目录。
- `route.ts`（在 `api/` 目录下）是 API 端点，只在服务端执行。

**示例映射：**

| 文件路径 | URL |
|---------|-----|
| `app/ma/dashboard/tools/page.tsx` | `/ma/dashboard/tools` |
| `app/ma/dashboard/tools/nav-cleaner/page.tsx` | `/ma/dashboard/tools/nav-cleaner` |
| `app/ma/api/tools/nav-cleaner/analyze/route.ts` | `/ma/api/tools/nav-cleaner/analyze` |

### 3.2 认证保护

MA 看板的鉴权在 `app/ma/dashboard/layout.tsx` 中完成：

```tsx
const current = authService.getCurrentUser()
if (!current) {
  router.replace("/login")               // 未登录 → 跳登录页
} else if (current.role !== "admin" && !current.permissions?.ma) {
  router.replace("/dashboard")           // 无 ma 权限 → 跳赛博看板
}
```

用户权限结构（`lib/auth.ts`）：

```ts
type PagePermissions = {
  ma?: boolean      // 访问 MA 看板
  classic?: boolean // 访问传统首页
  mom?: boolean     // 访问 MOM 分析（MA 看板内子权限）
}
```

API Routes 无自动鉴权中间件，敏感操作需在 `route.ts` 内手动检查 `x-market-user-id` 请求头。普通数据查询 API 无需鉴权。

---

## 四、数据库访问模式

数据库连接通过 `lib/db.ts` 统一管理，**只能在服务端（API Routes / Server Components）调用**，不能在 `"use client"` 文件中直接使用。

```ts
import { query, n, fmtIso } from "@/lib/db"

// query<RowType>(sql, params?) → Promise<RowType[]>
const rows = await query<{ symbol: string; close: string }>(
  `SELECT symbol, close FROM some_table WHERE trade_date = $1`,
  ["2025-01-01"]
)

// n() 将 pg 返回的 NUMERIC 字符串安全转为 number | null
// fmtIso() 将 DATE 字段格式化为 "YYYY-MM-DD"
```

环境变量（`.env.local`）：
```
DATABASE_URL=postgresql://user:pass@host:5432/market_data
# 或分开配置：
DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD
```

---

## 五、UI 组件使用规范

所有基础 UI 组件位于 `components/ui/`，基于 shadcn/ui 封装，直接按需导入：

```tsx
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
```

图表使用 ECharts（推荐，其余页面均在使用）：

```tsx
import ReactECharts from "echarts-for-react"
// <ReactECharts option={option} style={{ height: "400px" }} />
```

---

## 六、现有小工具结构参考

`tools/` 下每个小工具遵循以下固定结构：

```
app/ma/dashboard/tools/<工具名>/
    page.tsx                      # 前端页面（"use client"）
app/ma/api/tools/<工具名>/
    <动作>/route.ts               # 后端 API Route
lib/server/
    <工具名>.ts                   # （可选）复杂业务逻辑单独封装
```

**参考：净值表清洗工具**

- 前端：`app/ma/dashboard/tools/nav-cleaner/page.tsx`
  - 文件上传 → POST `/ma/api/tools/nav-cleaner/analyze` → 展示分析结果表格 → 下载
- 后端：`app/ma/api/tools/nav-cleaner/analyze/route.ts`
  - 接收 `FormData`，调用 `lib/server/nav-cleaner.ts` 的业务函数，返回 JSON
- 业务逻辑：`lib/server/nav-cleaner.ts`（xlsx 解析、列名推断等）

---

## 七、新增"估值表分析"小工具 — 开发步骤

### 7.1 需要新增/修改的文件清单

| 操作 | 文件 |
|------|------|
| **新建** | `app/ma/dashboard/tools/valuation/page.tsx` |
| **新建** | `app/ma/api/tools/valuation/` 下的若干 `route.ts` |
| **修改** | `app/ma/dashboard/tools/page.tsx`（在卡片列表中注册入口） |
| **修改** | （可选）`lib/server/valuation.ts`（复杂业务逻辑） |

### 7.2 步骤一：在小工具入口页注册卡片

编辑 `app/ma/dashboard/tools/page.tsx`，在 `toolCards` 数组中追加一项：

```tsx
import { BarChart3, FileSpreadsheet, Mail, Wrench } from "lucide-react"

const toolCards = [
  // ... 现有两项 ...
  {
    title: "估值表分析",
    description: "上传或选择估值数据，自动计算 PE/PB/股息率等估值指标，并支持历史分位数对比与图表展示。",
    href: "/ma/dashboard/tools/valuation",
    icon: BarChart3,
    actionLabel: "打开小工具",
  },
]
```

### 7.3 步骤二：创建前端页面

新建 `app/ma/dashboard/tools/valuation/page.tsx`：

```tsx
"use client"

import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function ValuationToolPage() {
  return (
    <div className="space-y-6 pt-6">
      {/* 面包屑返回 */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/ma/dashboard/tools">
            <ArrowLeft className="mr-1 h-4 w-4" />
            返回小工具
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-3xl font-semibold tracking-tight">估值表分析</h1>
        <p className="mt-2 text-muted-foreground">估值指标计算与历史分位数对比</p>
      </div>

      {/* 你的内容区域 */}
      <Card>
        <CardHeader>
          <CardTitle>估值数据</CardTitle>
        </CardHeader>
        <CardContent>
          {/* TODO: 表格/图表/上传区域 */}
        </CardContent>
      </Card>
    </div>
  )
}
```

### 7.4 步骤三：创建后端 API Route

新建 `app/ma/api/tools/valuation/<动作>/route.ts`，例如查询当前估值数据：

```ts
// app/ma/api/tools/valuation/data/route.ts
import { NextResponse } from "next/server"
import { query, n, fmtIso } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const rows = await query(`
      SELECT trade_date, code, name, pe_ttm, pb, dividend_yield
      FROM your_valuation_table
      ORDER BY trade_date DESC
      LIMIT 100
    `)
    return NextResponse.json({ data: rows })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
```

前端通过 `fetch("/ma/api/tools/valuation/data")` 调用。

### 7.5 步骤四：在侧边栏配置（如需独立导航项）

如果估值分析规模较大，需要在侧边栏单独显示，编辑  
`components/ma/dashboard-sidebar.tsx` 的 `baseNavigation` 数组添加条目。  
**若只是小工具之一，直接走 tools 入口卡片，无需修改侧边栏。**

---

## 八、开发本地环境启动

```bash
# 安装依赖
pnpm install

# 复制并配置环境变量
cp .env.example .env.local
# 填写 DATABASE_URL 等

# 启动开发服务器（默认 :3000）
pnpm dev
```

修改 `page.tsx` 或 `route.ts` 后热更新自动生效，无需重启。

---

## 九、代码风格约定

1. **所有浏览器执行的文件顶部必须写 `"use client"`**；API Routes 和 `lib/server/` 内的文件绝不加此指令。
2. 路径别名 `@/` 指向项目根目录（`tsconfig.json` 中配置），统一使用 `@/components/…`、`@/lib/…`。
3. 数据库 NUMERIC 字段用 `n()` 转换，DATE 字段用 `fmtIso()` / `fmtYmd()` 格式化。
4. API 返回错误时统一格式：`{ error: "message" }` + 非 2xx 状态码。
5. Toast 通知使用 `useToast()` hook（`@/hooks/use-toast`）。
6. 图标使用 `lucide-react`，与现有页面保持一致。

---

## 十、文件快速定位参考

| 我想改… | 去找… |
|--------|-------|
| 左侧导航菜单项 | `components/ma/dashboard-sidebar.tsx` → `baseNavigation` |
| 顶部栏 | `components/dashboard-header.tsx` |
| 小工具卡片列表 | `app/ma/dashboard/tools/page.tsx` → `toolCards` |
| 数据库连接配置 | `.env.local` + `lib/db.ts` |
| 用户权限逻辑 | `lib/auth.ts` + `lib/server/users.ts` |
| 全局 CSS / 主题变量 | `app/globals.css` |
| 部署配置 | `ecosystem.config.js`（PM2）、`deploy/nginx/` |



