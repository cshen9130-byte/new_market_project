"use client"

import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function RiskReportNewPage() {
  return (
    <div className="space-y-6 pt-6">
      <div className="flex items-center gap-3">
        <Link href="/ma/dashboard/mom-analysis">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">MOM 风控报告（新版）</h1>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">页面建设中，敬请期待。</p>
    </div>
  )
}
