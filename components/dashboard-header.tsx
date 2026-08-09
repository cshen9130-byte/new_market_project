"use client"

import Link from "next/link"
import { LogoutButton } from "@/components/logout-button"
import { Bot, Moon, Sun, Menu, UserRound } from "lucide-react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"

interface DashboardHeaderProps {
  user: {
    email: string | null
    full_name: string | null
  }
  onChatToggle?: () => void
  onMenuToggle?: () => void
}

export function DashboardHeader({ user, onChatToggle, onMenuToggle }: DashboardHeaderProps) {
  const { theme, setTheme } = useTheme()

  return (
    <header className="border-b bg-card">
      <div className="flex h-16 items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-3">
          {onMenuToggle && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onMenuToggle}
              className="h-9 w-9 md:hidden"
              title="菜单"
            >
              <Menu className="h-5 w-5" />
              <span className="sr-only">菜单</span>
            </Button>
          )}
          <div className="flex flex-col">
            <span className="text-sm font-medium">{user.full_name || "分析师"}</span>
            <span className="hidden sm:block text-xs text-muted-foreground">{user.email}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onChatToggle && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onChatToggle}
              className="h-9 w-9"
              title="AI 助手"
            >
              <Bot className="h-4 w-4" />
              <span className="sr-only">AI 助手</span>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="h-9 w-9"
          >
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            <span className="sr-only">切换主题</span>
          </Button>
          <Link
            href="/ma/dashboard/settings?section=user-center"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <UserRound className="h-4 w-4" />
            用户中心
          </Link>
          <LogoutButton />
        </div>
      </div>
    </header>
  )
}
