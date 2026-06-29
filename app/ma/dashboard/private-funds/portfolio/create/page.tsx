"use client"

import { useSearchParams } from "next/navigation"
import { PortfolioFreeCreateWizard, PortfolioSectionShell } from "@/components/ma/portfolio-free-create-wizard"
import { PortfolioModelCreateWizard } from "@/components/ma/portfolio-model-create-wizard"

export default function PortfolioCreatePage() {
  const searchParams = useSearchParams()
  const buildType = searchParams.get("build")

  if (buildType === "model") {
    return <PortfolioModelCreateWizard />
  }

  return (
    <PortfolioSectionShell activeSideItem="port-new">
      <PortfolioFreeCreateWizard />
    </PortfolioSectionShell>
  )
}
