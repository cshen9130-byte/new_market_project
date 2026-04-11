"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { authService } from "@/lib/auth"
import { NeuralNetwork3D } from "@/components/neural-network-3d"
import { Button } from "@/components/ui/button"
import { BrainCircuit, LogOut } from "lucide-react"

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<{ name: string } | null>(null)

  useEffect(() => {
    const currentUser = authService.getCurrentUser()
    if (!currentUser) {
      router.push("/login")
    } else {
      setUser(currentUser)
    }
  }, [router])

  const handleLogout = () => {
    authService.logout()
    router.push("/login")
  }

  const routeForType = (type: string) => {
    if (type === "futures") return "/dashboard/futures-market"
    return `/analysis/${type}`
  }

  const handleInputClick = (type: string) => {
    router.push(routeForType(type))
  }

  const handleOutputClick = (type: string) => {
    router.push(routeForType(type))
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <div className="text-cyan-400 text-xl animate-pulse">正在加载神经网络...</div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen bg-black">
      <div className="absolute top-4 left-4 z-10 text-cyan-400 text-lg font-mono">欢迎，{user.name}</div>

      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        <Button
          onClick={() => router.push("/dashboard/ai-knowledge")}
          variant="outline"
          className="border-cyan-500/30 bg-black/80 text-cyan-400 hover:bg-cyan-500/20"
        >
          <BrainCircuit className="w-4 h-4 sm:mr-2" />
          <span className="hidden sm:inline">AI知识库</span>
        </Button>

        <Button
          onClick={handleLogout}
          variant="outline"
          className="border-cyan-500/30 bg-black/80 text-cyan-400 hover:bg-cyan-500/20"
        >
          <LogOut className="w-4 h-4 sm:mr-2" />
          <span className="hidden sm:inline">退出登录</span>
        </Button>
      </div>

      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-0 text-center">
          <h1 className="text-4xl font-bold text-cyan-400 mb-2 font-mono">市场环境监测系统</h1>
        <p className="text-cyan-300/60 text-sm">点击神经元以查看市场数据</p>
      </div>

      <NeuralNetwork3D onInputClick={handleInputClick} onOutputClick={handleOutputClick} />
    </div>
  )
}
