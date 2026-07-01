"use client"

import { useSearchParams } from "next/navigation"
import { FundCompareSectionShell } from "@/components/ma/fund-compare-section-shell"
import { getDueDiligenceReport } from "@/lib/ma/due-diligence-reports"
import { DueDiligenceGeneralReportEditorView } from "../../components/DueDiligenceGeneralReportEditorView"
import { DueDiligenceReportEditorView } from "../../components/DueDiligenceReportEditorView"

export default function NewDueDiligenceReportPage() {
  const searchParams = useSearchParams()
  const reportId = searchParams.get("id")
  const report = reportId ? getDueDiligenceReport(reportId) : null
  const template = report?.templateId ?? (searchParams.get("template") === "general" ? "general" : "simple")
  const preview = searchParams.get("preview") === "1"

  return (
    <FundCompareSectionShell activeSideItem="inv-dd-report">
      {template === "general" ? (
        <DueDiligenceGeneralReportEditorView preview={preview} reportId={reportId} />
      ) : (
        <DueDiligenceReportEditorView preview={preview} reportId={reportId} />
      )}
    </FundCompareSectionShell>
  )
}
