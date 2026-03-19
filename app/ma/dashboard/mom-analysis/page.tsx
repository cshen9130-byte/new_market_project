import Link from "next/link"
import { Download, FileText, Upload } from "lucide-react"

import { Button } from "@/components/ui/button"

const momReportUrl = (process.env.NEXT_PUBLIC_MOM_REPORT_URL || "/mom_report/report.html?v=debug") as string
const downloadHref = "/mom_report/report.html"

const functions = [
  {
    title: "MOM 风控报告",
    description: "查看最新 MOM 月度风控报告，支持在线浏览与下载。",
    href: momReportUrl,
    downloadHref,
    icon: FileText,
    openInNewTab: true,
  },
  {
    title: "数据导入",
    description: "上传逐日核算 ZIP 包，自动解压、标准化命名并检查交易日覆盖情况。",
    href: "/ma/dashboard/mom-analysis/data-import",
    downloadHref: null,
    icon: Upload,
    openInNewTab: false,
  },
]

export default function MomAnalysisPage() {
  return (
    <div className="space-y-6 pt-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">MOM分析</h1>
        <p className="mt-2 text-muted-foreground">月度绩效分析与归因。</p>
      </div>

      <div className="inline-flex flex-col divide-y divide-border rounded-lg border border-border/60 bg-card overflow-hidden">
        {functions.map((fn) => {
          const Icon = fn.icon

          return (
            <div key={fn.title} className="relative flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/50 cursor-pointer">
              {fn.openInNewTab ? (
                <a href={fn.href} target="_blank" rel="noopener noreferrer" className="absolute inset-0" aria-label={fn.title} />
              ) : (
                <Link href={fn.href} className="absolute inset-0" aria-label={fn.title} />
              )}
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-muted/40">
                <Icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium leading-none">{fn.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{fn.description}</p>
              </div>
              {fn.downloadHref && (
                <div className="relative z-10 shrink-0 pl-1">
                  <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground" title="下载报告">
                    <a href={fn.downloadHref} download>
                      <Download className="h-4 w-4" />
                    </a>
                  </Button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
