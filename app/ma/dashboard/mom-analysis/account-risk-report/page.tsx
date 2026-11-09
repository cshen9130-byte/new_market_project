"use client"

import { Suspense } from "react"
import { RiskReportApp } from "@/components/ma/risk-report-app"

export default function AccountRiskReportPage() {
  return (
    <Suspense fallback={null}>
      <RiskReportApp variant="account" />
    </Suspense>
  )
}
