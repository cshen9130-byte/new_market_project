"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { FileText, LayoutTemplate } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { loadReportTemplates, normalizeTemplate, type ReportCustomTemplate } from "@/lib/ma/report-template-types"
import { FofWeeklyReportDialog } from "./FofWeeklyReportDialog"
import { FofMonthlyReportDialog } from "./FofMonthlyReportDialog"
import { ProductMonthlyReportDialog } from "./ProductMonthlyReportDialog"
import { FundOfficialMonthlyReportDialog } from "./FundOfficialMonthlyReportDialog"
import { ReportTemplateExampleDialog } from "./ReportTemplateExampleDialog"
import { CustomReportGenerateDialog, CustomTemplateCard } from "./CustomReportGenerateDialog"

type TemplateCategory = "weekly" | "monthly" | "custom" | "other"
type ReportWizardStep = "pick" | "fof-weekly" | "fof-monthly" | "product-monthly" | "fund-official-monthly" | "custom-report"
type FofMonthlyLayout = "curve" | "review"

interface ReportTemplate {
  id: string
  title: string
  description: string
  badgeLabel: string
  exampleUrl?: string
  exampleKind?: "image" | "pdf"
  exampleCaption?: string
}

const TEMPLATE_CATEGORIES: { key: TemplateCategory; label: string }[] = [
  { key: "weekly", label: "产品周报" },
  { key: "monthly", label: "产品月报" },
  { key: "custom", label: "自定义报告" },
  { key: "other", label: "其他" },
]

const TEMPLATES_BY_CATEGORY: Record<"weekly" | "monthly" | "other", ReportTemplate[]> = {
  weekly: [
    {
      id: "weekly-track-curve",
      title: "跟踪产品（通用曲线版）",
      description: "显示产品指标和曲线",
      badgeLabel: "周报",
      exampleUrl: "/ma/api/reports/fof-weekly/example",
    },
    {
      id: "weekly-track-general",
      title: "跟踪产品（通用版）",
      description: "显示产品指标，无净值曲线",
      badgeLabel: "周报",
    },
    {
      id: "weekly-invest-general",
      title: "投资周报通用版",
      description: "包含内容描述和产品指标",
      badgeLabel: "周报",
    },
    {
      id: "weekly-track-group-curve",
      title: "跟踪产品（分组曲线版）",
      description: "按分组展示指标和收益曲线",
      badgeLabel: "周报",
    },
    {
      id: "weekly-invest-general-2",
      title: "投资周报通用版2",
      description: "包含内容描述和产品指标，公司产品包含曲线",
      badgeLabel: "周报",
    },
  ],
  monthly: [
    {
      id: "monthly-track-curve",
      title: "跟踪产品（通用曲线版）",
      description: "竖版月报 · 指标卡片与净值曲线",
      badgeLabel: "月报",
      exampleUrl: "/ma/api/reports/fof-monthly/example?layout=curve",
      exampleCaption: "低波稳健FOF 1号 · 2026-06-26 · 竖版曲线",
    },
    {
      id: "monthly-review",
      title: "跟踪产品（月度回顾版）",
      description: "深色仪表盘 · 3D卡片 · 月度收益环形图",
      badgeLabel: "月报",
      exampleUrl: "/ma/api/reports/fof-monthly/example?layout=review",
      exampleCaption: "低波稳健FOF 1号 · 2026-06-26 · 深色仪表盘版",
    },
    {
      id: "monthly-pe-official",
      title: "私募基金月报-官方",
      description: "适用组合策略基金",
      badgeLabel: "月报",
      exampleUrl: "/ma/api/reports/product-monthly/example",
      exampleKind: "pdf",
    },
    {
      id: "monthly-fund-official",
      title: "单产品投资月报",
      description: "产品概览 · 经理简介 · 净值走势 · 业绩与持仓",
      badgeLabel: "月报",
      exampleUrl: "/ma/api/reports/fund-official-monthly/example",
      exampleCaption: "单产品官方投资月报版式示例",
    },
  ],
  other: [],
}

function TemplateThumbnail({ badgeLabel }: { badgeLabel: string }) {
  return (
    <div className="relative mx-auto flex h-[88px] w-[88px] items-center justify-center rounded bg-zinc-100 dark:bg-zinc-800">
      <span className="absolute left-1.5 top-1.5 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-500 dark:bg-red-950/40">
        官方
      </span>
      <div className="relative flex h-14 w-11 flex-col items-center justify-end rounded-sm border border-zinc-200 bg-white shadow-sm dark:border-zinc-600 dark:bg-zinc-900">
        <div className="mb-1 flex h-7 w-full items-center justify-center bg-zinc-50 dark:bg-zinc-800">
          <FileText className="h-4 w-4 text-zinc-300 dark:text-zinc-500" strokeWidth={1.5} />
        </div>
        <span className="mb-1 rounded-sm bg-sky-500 px-1.5 py-0.5 text-[9px] font-medium leading-none text-white">
          {badgeLabel}
        </span>
      </div>
    </div>
  )
}

function TemplateCard({
  template,
  onViewExample,
  onUseTemplate,
}: {
  template: ReportTemplate
  onViewExample?: (template: ReportTemplate) => void
  onUseTemplate?: (template: ReportTemplate) => void
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-background">
      <div className="border-b bg-zinc-50/80 px-4 py-5 dark:bg-zinc-900/40">
        <TemplateThumbnail badgeLabel={template.badgeLabel} />
      </div>
      <div className="flex flex-1 flex-col px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground leading-snug">{template.title}</h3>
        <p className="mt-1.5 flex-1 text-xs leading-relaxed text-zinc-400">{template.description}</p>
        <div className="mt-3 flex items-center justify-center gap-3 border-t pt-3 text-xs">
          <button
            type="button"
            disabled={!template.exampleUrl}
            onClick={() => onViewExample?.(template)}
            className="text-sky-600 hover:text-sky-700 disabled:cursor-not-allowed disabled:text-zinc-300 dark:text-sky-400 dark:disabled:text-zinc-600"
          >
            查看范例
          </button>
          <span className="h-3 w-px bg-border" />
          <button
            type="button"
            onClick={() => onUseTemplate?.(template)}
            className="text-sky-600 hover:text-sky-700 dark:text-sky-400"
          >
            使用模板
          </button>
        </div>
      </div>
    </div>
  )
}

export function NewReportDialog({
  open,
  onClose,
  onCustomReportSaved,
}: {
  open: boolean
  onClose: () => void
  onCustomReportSaved?: () => void
}) {
  const [step, setStep] = useState<ReportWizardStep>("pick")
  const [category, setCategory] = useState<TemplateCategory>("weekly")
  const [exampleTemplate, setExampleTemplate] = useState<ReportTemplate | null>(null)
  const [customTemplates, setCustomTemplates] = useState<ReportCustomTemplate[]>([])
  const [selectedCustom, setSelectedCustom] = useState<ReportCustomTemplate | null>(null)
  const [monthlyLayout, setMonthlyLayout] = useState<FofMonthlyLayout>("review")

  useEffect(() => {
    if (open) {
      setStep("pick")
      setCategory("weekly")
      setExampleTemplate(null)
      setSelectedCustom(null)
      setMonthlyLayout("review")
      setCustomTemplates(loadReportTemplates().map(normalizeTemplate))
    }
  }, [open])

  const officialTemplates = category === "custom" ? [] : TEMPLATES_BY_CATEGORY[category as "weekly" | "monthly" | "other"]

  function handleUseOfficialTemplate(template: ReportTemplate) {
    if (template.id === "weekly-track-curve") {
      setStep("fof-weekly")
      return
    }
    if (template.id === "monthly-track-curve") {
      setMonthlyLayout("curve")
      setStep("fof-monthly")
      return
    }
    if (template.id === "monthly-review") {
      setMonthlyLayout("review")
      setStep("fof-monthly")
      return
    }
    if (template.id === "monthly-pe-official") {
      setStep("product-monthly")
      return
    }
    if (template.id === "monthly-fund-official") {
      setStep("fund-official-monthly")
    }
  }

  function handleUseCustomTemplate(template: ReportCustomTemplate) {
    setSelectedCustom(template)
    setStep("custom-report")
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
        {step === "pick" && (
          <DialogContent className="flex max-h-[85vh] w-[960px] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[960px]" showCloseButton>
            <DialogHeader className="border-b px-6 py-4 text-left">
              <DialogTitle className="text-base font-semibold">新建报告</DialogTitle>
            </DialogHeader>

            <div className="flex min-h-0 flex-1">
              <aside className="w-36 shrink-0 border-r bg-background">
                <div className="px-4 pt-4 pb-1 text-[11px] font-semibold tracking-wide text-zinc-400 select-none">
                  模板分类
                </div>
                <nav className="flex flex-col pb-4">
                  {TEMPLATE_CATEGORIES.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setCategory(item.key)}
                      className={[
                        "w-full px-4 py-2 text-left text-sm transition-colors",
                        category === item.key
                          ? "font-medium text-red-600 dark:text-red-400"
                          : "text-zinc-600 dark:text-zinc-400 hover:text-foreground",
                      ].join(" ")}
                    >
                      {item.label}
                    </button>
                  ))}
                </nav>
              </aside>

              <div className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
                {category === "custom" ? (
                  <>
                    <p className="mb-5 text-sm text-zinc-500">
                      使用在
                      {" "}
                      <Link href="/ma/dashboard/private-funds?tab=reports&side=rpt-templates" className="text-red-500 hover:underline" onClick={onClose}>
                        模板管理
                      </Link>
                      {" "}
                      中保存的自定义模板。用户需填写的内容在模板的「用户输入」中配置。
                    </p>
                    {customTemplates.length > 0 ? (
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {customTemplates.map((template) => (
                          <CustomTemplateCard
                            key={template.id}
                            template={template}
                            onUse={() => handleUseCustomTemplate(template)}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-3">
                        <LayoutTemplate className="h-10 w-10 text-zinc-300" />
                        <span className="text-sm">暂无自定义模板</span>
                        <Link
                          href="/ma/dashboard/private-funds?tab=reports&side=rpt-templates"
                          className="text-sm text-red-500 hover:text-red-600"
                          onClick={onClose}
                        >
                          前往模板管理创建 →
                        </Link>
                      </div>
                    )}
                  </>
                ) : category === "other" ? (
                  <>
                    <p className="mb-5 text-sm text-zinc-400">联系客服，提交自定义模板。</p>
                    <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                      暂无模板
                    </div>
                  </>
                ) : (
                  <div
                    className={[
                      "grid grid-cols-1 gap-4 sm:grid-cols-2",
                      // Monthly has 4 official templates — keep 2x2 so the 4th isn't clipped below the fold.
                      category === "monthly" ? "lg:grid-cols-2" : "lg:grid-cols-3",
                    ].join(" ")}
                  >
                    {officialTemplates.map((template) => (
                      <TemplateCard
                        key={template.id}
                        template={template}
                        onViewExample={(t) => setExampleTemplate(t)}
                        onUseTemplate={handleUseOfficialTemplate}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </DialogContent>
        )}
        {step === "fof-weekly" && (
          <FofWeeklyReportDialog embedded open={open} onClose={onClose} onBack={() => setStep("pick")} />
        )}
        {step === "fof-monthly" && (
          <FofMonthlyReportDialog
            embedded
            open={open}
            layout={monthlyLayout}
            onClose={onClose}
            onBack={() => setStep("pick")}
          />
        )}
        {step === "product-monthly" && (
          <ProductMonthlyReportDialog embedded open={open} onClose={onClose} onBack={() => setStep("pick")} />
        )}
        {step === "fund-official-monthly" && (
          <FundOfficialMonthlyReportDialog embedded open={open} onClose={onClose} onBack={() => setStep("pick")} />
        )}
        {step === "custom-report" && selectedCustom && (
          <CustomReportGenerateDialog
            embedded
            open={open}
            template={selectedCustom}
            onClose={onClose}
            onBack={() => setStep("pick")}
            onSaved={() => onCustomReportSaved?.()}
          />
        )}
      </Dialog>
      {exampleTemplate?.exampleUrl && (
        <ReportTemplateExampleDialog
          open
          title={exampleTemplate.title}
          exampleUrl={exampleTemplate.exampleUrl}
          exampleKind={exampleTemplate.exampleKind}
          exampleCaption={exampleTemplate.exampleCaption}
          onClose={() => setExampleTemplate(null)}
        />
      )}
    </>
  )
}
