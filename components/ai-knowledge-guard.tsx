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
    const user = authService.getCurrentUser()
    if (!user) {
      router.replace("/login")
      return
    }
    if (!canAccessAiKnowledge(user)) {
      router.replace(redirectTo)
    }
  }, [router, redirectTo])

  return <>{children}</>
}
