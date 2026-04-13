"use client"

import type React from "react"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { DashboardSidebar } from "@/components/ma/dashboard-sidebar"
import { DashboardHeader } from "@/components/dashboard-header"
import { ChatBotWidget } from "@/components/chat-bot-widget"
import { authService, type User } from "@/lib/auth"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [chatVisible, setChatVisible] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  useEffect(() => {
    const current = authService.getCurrentUser()
    if (!current) {
      router.replace("/login")
    } else if (current.role !== "admin" && !current.permissions?.ma) {
      router.replace("/dashboard")
    } else {
      setUser(current)
    }
  }, [router])

  if (!user) return null

  const headerUser = { email: user.email, full_name: user.name }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <DashboardSidebar mobileOpen={mobileSidebarOpen} onMobileClose={() => setMobileSidebarOpen(false)} />
      <div className="flex flex-col flex-1 overflow-hidden">
        <DashboardHeader user={headerUser} onChatToggle={() => setChatVisible((v) => !v)} onMenuToggle={() => setMobileSidebarOpen((v) => !v)} />
        <main className="flex-1 overflow-y-auto px-4 md:px-6 pb-6">{children}</main>
      </div>
      <ChatBotWidget visible={chatVisible} onClose={() => setChatVisible(false)} />
    </div>
  )
}
