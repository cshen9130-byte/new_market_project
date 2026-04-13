"use client"

import type React from "react"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { authService } from "@/lib/auth"

export default function MomAnalysisLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [allowed, setAllowed] = useState<boolean | null>(null)

  useEffect(() => {
    const user = authService.getCurrentUser()
    if (!user) {
      router.replace("/login")
    } else if (user.role === "admin" || user.permissions?.mom) {
      setAllowed(true)
    } else {
      setAllowed(false)
      router.replace("/ma/dashboard")
    }
  }, [router])

  if (allowed === null) return null
  if (!allowed) return null
  return <>{children}</>
}
