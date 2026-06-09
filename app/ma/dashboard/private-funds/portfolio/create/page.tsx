"use client"

import { PortfolioFreeCreateWizard, PortfolioSectionShell } from "@/components/ma/portfolio-free-create-wizard"

export default function PortfolioFreeCreatePage() {
  return (
    <PortfolioSectionShell activeSideItem="port-new">
      <PortfolioFreeCreateWizard />
    </PortfolioSectionShell>
  )
}
