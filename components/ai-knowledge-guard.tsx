"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { authService } from "@/lib/auth"
import { canAccessAiKnowledge } from "@/lib/permissions"

export function AIKnowledgeGuard({
  children,
  redirectTo,
}: {
  children: React.ReactNode
  redirectTo: string
}) {
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    async function check() {
      const user = await authService.refreshCurrentUser()
      if (cancelled) return
      if (!user) {
        router.replace("/login")
        return
      }
      if (!canAccessAiKnowledge(user)) {
        router.replace(redirectTo)
      }
    }
    check()
    return () => {
      cancelled = true
    }
  }, [router, redirectTo])

  return <>{children}</>
}
