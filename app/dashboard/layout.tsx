"use client"

import type React from "react"
import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { authService } from "@/lib/auth"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  useEffect(() => {
    const current = authService.getCurrentUser()
    if (!current) {
      router.replace("/login")
    }
  }, [router])
  return <>{children}</>
}
