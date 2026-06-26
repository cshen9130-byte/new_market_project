"use client"

import { ChevronDown, LayoutTemplate, Settings2 } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export type MetricTemplate = { name: string; items: { period: string; metric: string }[] }

export function loadMetricTemplates(): MetricTemplate[] {
  if (typeof window === "undefined") return []
  try {
    return JSON.parse(localStorage.getItem("tracking_metric_templates") ?? "[]")
  } catch {
    return []
  }
}

export function MetricTemplatePicker({
  activeTemplate,
  templates,
  onOpen,
  onSelectDefault,
  onSelectTemplate,
}: {
  activeTemplate: string | null
  templates: MetricTemplate[]
  onOpen?: () => void
  onSelectDefault: () => void
  onSelectTemplate: (template: MetricTemplate) => void
}) {
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) onOpen?.()
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-zinc-600 hover:text-zinc-900 transition-colors"
        >
          <LayoutTemplate className="h-3.5 w-3.5 text-zinc-400" />
          {activeTemplate ?? "默认模板"}
          <ChevronDown className="h-3 w-3 opacity-80" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[10rem] p-1">
        <button
          type="button"
          onClick={onSelectDefault}
          className={[
            "flex w-full items-center gap-2 rounded-sm px-3 py-2 text-xs text-left transition-colors",
            activeTemplate === null ? "bg-red-50 text-zinc-800" : "hover:bg-zinc-50 text-zinc-700",
          ].join(" ")}
        >
          <LayoutTemplate className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
          默认模板
        </button>
        {templates.map((template) => (
          <button
            key={template.name}
            type="button"
            onClick={() => onSelectTemplate(template)}
            className={[
              "flex w-full items-center rounded-sm px-3 py-2 text-xs text-left transition-colors truncate",
              activeTemplate === template.name ? "bg-red-50 text-zinc-800" : "hover:bg-zinc-50 text-zinc-700",
            ].join(" ")}
          >
            {template.name}
          </button>
        ))}
        <DropdownMenuSeparator className="my-1" />
        <button
          type="button"
          onClick={() => window.open("/ma/dashboard/settings?tab=metric-templates", "_blank")}
          className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-xs text-left text-red-500 hover:bg-zinc-50 transition-colors"
        >
          <Settings2 className="h-3.5 w-3.5 shrink-0" />
          管理模板
        </button>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
