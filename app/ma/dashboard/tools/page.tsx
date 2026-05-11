import Link from "next/link"
import { FileSpreadsheet, Mail, PieChart, Wrench } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const toolCards = [
  {
    title: "净值表识别及清洗",
    description: "上传 xlsx/csv 等净值文件，自动识别列名与日期格式，并转换到上传净值模版。",
    href: "/ma/dashboard/tools/nav-cleaner",
    icon: FileSpreadsheet,
    actionLabel: "打开小工具",
  },
  {
    title: "自动发邮件",
    description: "为每位投顾配置定时发送任务，每天自动将最新逐日核算单 xlsx 附件发送至指定邮箱，支持多配置管理与手动立即发送。",
    href: "/ma/dashboard/tools/send-email",
    icon: Mail,
    actionLabel: "打开小工具",
  },
  {
    title: "估值分析",
    description: "上传持仓估值表，自动解析持仓结构，生成多头空头分布、行业集中度、策略标签等可视化分析报告。",
    href: "/ma/dashboard/tools/valuation",
    icon: PieChart,
    actionLabel: "打开小工具",
  },
]

export default function ToolsPage() {
  return (
    <div className="space-y-6 pt-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">小工具</h1>
        <p className="mt-2 text-muted-foreground">数据处理与辅助分析工具集合。</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {toolCards.map((tool) => {
          const Icon = tool.icon

          return (
            <Card key={tool.title} className="border-border/60">
              <CardHeader className="space-y-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border bg-muted/40">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle>{tool.title}</CardTitle>
                  <CardDescription className="mt-2">{tool.description}</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <Button asChild className="w-full justify-between">
                  <Link href={tool.href}>
                    {tool.actionLabel}
                    <Wrench className="h-4 w-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}