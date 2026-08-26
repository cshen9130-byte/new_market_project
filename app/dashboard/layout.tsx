"use client"

import type React from "react"
import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { authService } from "@/lib/auth"
import { usePresenceHeartbeat } from "@/hooks/use-presence-heartbeat"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [userId, setUserId] = useState<string | null>(null)
  usePresenceHeartbeat(userId, pathname)
  useEffect(() => {
    const current = authService.getCurrentUser()
    setUserId(current?.id ?? null)
    // Allow admin and db-explorer routes to render their own unauthorized views
    const isAdminRoute =
      pathname === "/dashboard/admin" ||
      pathname === "/dashboard/db-explorer" ||
      pathname === "/dashboard/all-weather"
    if (!current && !isAdminRoute) {
      router.replace("/login")
    }
  }, [router, pathname])
  return <>{children}</>
}
