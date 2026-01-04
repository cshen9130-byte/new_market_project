"use client"

import type React from "react"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { MatrixRain } from "@/components/matrix-rain"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { authService } from "@/lib/auth"
import { useToast } from "@/hooks/use-toast"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Eye, EyeOff } from "lucide-react"
import { cn } from "@/lib/utils"

export default function LoginPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(false)
  const [styleChoice, setStyleChoice] = useState<"cyber" | "classic">("cyber")
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    // Ensure a default local user exists for quick login
    authService.init()
  }, [])

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsLoading(true)

    const formData = new FormData(e.currentTarget)
    const identifier = formData.get("identifier") as string
    const password = formData.get("password") as string

    const user = authService.login(identifier, password)

    if (user) {
      toast({
        title: "登录成功",
        description: `欢迎回来，${user.name}!`,
      })
      if (styleChoice === "cyber") {
        router.push("/dashboard")
      } else {
        router.push("/ma/dashboard")
      }
    } else {
      toast({
        title: "登录失败",
        description: "邮箱/账号或密码错误",
        variant: "destructive",
      })
    }

    setIsLoading(false)
  }

  // 注册模块已删除

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-black">
      <MatrixRain />

      <Card className="relative z-10 w-full max-w-md mx-4 bg-black/80 backdrop-blur-sm border-emerald-500/30">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center text-emerald-400">市场环境监测系统</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-1 bg-emerald-950/50">
              <TabsTrigger
                value="login"
                className="data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-400"
              >
                登录
              </TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-identifier" className="text-emerald-400">
                    账户名
                  </Label>
                  <Input
                    id="login-identifier"
                    name="identifier"
                    type="text"
                    placeholder="请输入账户名（例如 ben）"
                    required
                    className="bg-black/50 border-emerald-500/30 text-emerald-100 placeholder:text-emerald-300/30"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password" className="text-emerald-400">
                    密码
                  </Label>
                  <div className="relative">
                    <Input
                      id="login-password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      required
                      className="bg-black/50 border-emerald-500/30 text-emerald-100 pr-10"
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? "隐藏密码" : "显示密码"}
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute inset-y-0 right-2 flex items-center text-emerald-400 hover:text-emerald-300"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                  {/* 风格选择 */}
                  <div className="space-y-2">
                    <Label className="text-emerald-400">风格选择</Label>
                    <RadioGroup
                      value={styleChoice}
                      onValueChange={(v) => setStyleChoice(v as any)}
                      className="grid grid-cols-2 gap-2"
                    >
                      <div
                        className={cn(
                          "flex items-center space-x-3 rounded border p-3 transition-colors",
                          styleChoice === "cyber"
                            ? "bg-emerald-900/40 border-emerald-400/60"
                            : "bg-black/40 border-emerald-500/30",
                        )}
                      >
                        <RadioGroupItem
                          value="cyber"
                          id="style-cyber"
                          className="size-5 border-emerald-400 data-[state=checked]:ring-2 data-[state=checked]:ring-emerald-400 data-[state=checked]:border-emerald-300"
                        />
                        <Label
                          htmlFor="style-cyber"
                          className={cn(
                            "text-emerald-300",
                            styleChoice === "cyber" && "text-emerald-200",
                          )}
                        >
                          赛博风格
                        </Label>
                      </div>
                      <div
                        className={cn(
                          "flex items-center space-x-3 rounded border p-3 transition-colors",
                          styleChoice === "classic"
                            ? "bg-emerald-900/30 border-emerald-400/60"
                            : "bg-black/40 border-emerald-500/30",
                        )}
                      >
                        <RadioGroupItem
                          value="classic"
                          id="style-classic"
                          className="size-5 border-emerald-400 data-[state=checked]:ring-2 data-[state=checked]:ring-emerald-400 data-[state=checked]:border-emerald-300"
                        />
                        <Label
                          htmlFor="style-classic"
                          className={cn(
                            "text-emerald-300",
                            styleChoice === "classic" && "text-emerald-200",
                          )}
                        >
                          传统风格
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-black font-semibold"
                >
                  {isLoading ? "正在进入..." : "进入系统"}
                </Button>
              </form>
            </TabsContent>

            {/* 注册模块已移除 */}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
