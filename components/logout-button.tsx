"use client"

import { Button } from "@/components/ui/button"
import { useRouter } from "next/navigation"
import { LogOut } from "lucide-react"
import { useState } from "react"
import { authService } from "@/lib/auth"

export function LogoutButton() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)

  const handleLogout = async () => {
    setIsLoading(true)
    authService.logout()
    router.push("/login")
  }

  return (
    <Button variant="ghost" size="sm" onClick={handleLogout} disabled={isLoading} className="gap-2">
      <LogOut className="h-4 w-4" />
      {isLoading ? "正在退出…" : "退出登录"}
    </Button>
  )
}
