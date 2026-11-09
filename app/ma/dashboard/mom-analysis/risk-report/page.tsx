"use client"

import { Suspense } from "react"
import { RiskReportApp } from "@/components/ma/risk-report-app"

export default function RiskReportNewPage() {
  return (
    <Suspense fallback={null}>
      <RiskReportApp variant="mom" />
    </Suspense>
  )
}
