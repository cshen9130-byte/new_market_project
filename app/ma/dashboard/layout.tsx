"use client"

import type React from "react"
import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { DashboardSidebar } from "@/components/ma/dashboard-sidebar"
import { cn } from "@/lib/utils"
import { DashboardHeader } from "@/components/dashboard-header"
import { ChatBotWidget } from "@/components/chat-bot-widget"
import { authService, type User } from "@/lib/auth"
import { canAccessAiKnowledge } from "@/lib/permissions"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const isPrivateFundsSection = pathname.startsWith("/ma/dashboard/private-funds")
  const [user, setUser] = useState<User | null>(null)
  const [chatVisible, setChatVisible] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function loadUser() {
      const current = await authService.refreshCurrentUser()
      if (cancelled) return
      if (!current) {
        router.replace("/login")
        return
      }
      if (current.role !== "admin" && !current.permissions?.ma) {
        router.replace("/dashboard")
        return
      }
      if (
        pathname.startsWith("/ma/dashboard/ai-knowledge") &&
        !canAccessAiKnowledge(current)
      ) {
        router.replace("/ma/dashboard")
        return
      }
      setUser(current)
    }
    loadUser()
    return () => {
      cancelled = true
    }
  }, [router, pathname])

  if (!user) return null

  const headerUser = { email: user.email, full_name: user.name }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <DashboardSidebar mobileOpen={mobileSidebarOpen} onMobileClose={() => setMobileSidebarOpen(false)} />
      <div className="flex flex-col flex-1 overflow-hidden">
        <DashboardHeader user={headerUser} onChatToggle={() => setChatVisible((v) => !v)} onMenuToggle={() => setMobileSidebarOpen((v) => !v)} />
        <main
          className={cn(
            "flex-1 px-4 md:px-6 pb-6",
            isPrivateFundsSection ? "min-h-0 overflow-hidden" : "overflow-y-auto",
          )}
        >
          {children}
        </main>
      </div>
      <ChatBotWidget visible={chatVisible} onClose={() => setChatVisible(false)} />
    </div>
  )
}
