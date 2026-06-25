"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { authService, User, PagePermissions } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { PERM_COLUMNS, buildPermissionsSnapshot } from "@/lib/page-permissions"

type UserTokenStats = {
  userId: string
  userName: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  requestCount: number
  lastUsed: string
}

type TokenRecord = {
  id: string
  userId: string
  userName: string
  timestamp: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  model: string
  questionPreview: string
}

export default function AdminAccountsPage() {
  const router = useRouter()
  const [authorized, setAuthorized] = useState<boolean>(false)
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState<boolean>(true)

  const [newName, setNewName] = useState("")
  const [newEmail, setNewEmail] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [newRole, setNewRole] = useState<"admin" | "user">("user")
  const [error, setError] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [editEmail, setEditEmail] = useState("")
  const [editPassword, setEditPassword] = useState("")
  const [editRole, setEditRole] = useState<"admin" | "user">("user")

  // Token usage stats
  const [tokenStats, setTokenStats] = useState<UserTokenStats[]>([])
  const [recentRecords, setRecentRecords] = useState<TokenRecord[]>([])
  const [totalTokens, setTotalTokens] = useState(0)
  const [totalRequests, setTotalRequests] = useState(0)
  const [tokenLoading, setTokenLoading] = useState(false)
  const [showRecentRecords, setShowRecentRecords] = useState(false)

  useEffect(() => {
    authService.init()
    const isAdmin = authService.isAdmin()
    setAuthorized(isAdmin)
    if (!isAdmin) {
      setLoading(false)
      return
    }
    refreshUsers()
    refreshTokenStats()
  }, [])

  async function refreshTokenStats() {
    setTokenLoading(true)
    try {
      const currentUser = authService.getCurrentUser()
      if (!currentUser) return
      const res = await fetch("/api/admin/token-usage", {
        headers: { "x-market-user-id": currentUser.id },
      })
      const data = await res.json()
      if (data?.ok) {
        setTokenStats(data.userStats ?? [])
        setRecentRecords(data.recentRecords ?? [])
        setTotalTokens(data.totalTokens ?? 0)
        setTotalRequests(data.totalRequests ?? 0)
      }
    } finally {
      setTokenLoading(false)
    }
  }

  async function refreshUsers() {
    setLoading(true)
    const list = await authService.listUsers()
    setUsers(list)
    syncPermMap(list)
    setLoading(false)
  }

  function startEdit(u: User) {
    setEditingId(u.id)
    setEditName(u.name)
    setEditEmail(u.email)
    setEditPassword("")
    setEditRole(u.role === "admin" ? "admin" : "user")
  }

  function cancelEdit() {
    setEditingId(null)
    setEditName("")
    setEditEmail("")
    setEditPassword("")
  }

  async function handleAdd() {
    setError(null)
    if (!newEmail || !newPassword || !newName) {
      setError("请填写完整信息")
      return
    }
    const { success, error } = await authService.addUser(newEmail, newPassword, newName, newRole)
    if (!success) {
      setError(error || "添加失败")
      return
    }
    setNewEmail("")
    setNewPassword("")
    setNewName("")
    setNewRole("user")
    refreshUsers()
  }

  async function handleDelete(id: string) {
    const ok = window.confirm("确认删除该用户？")
    if (!ok) return
    const res = await authService.deleteUser(id)
    if (!res.success) {
      setError(res.error || "删除失败")
      return
    }
    if (editingId === id) cancelEdit()
    refreshUsers()
  }

  async function handleSaveEdit() {
    if (!editingId) return
    const { success, error } = await authService.updateUser(editingId, {
      email: editEmail,
      name: editName,
      role: editRole,
      ...(editPassword ? { password: editPassword } : {}),
    })
    if (!success) {
      setError(error || "更新失败")
      return
    }
    cancelEdit()
    refreshUsers()
  }

  // Page permissions management
  const [permMap, setPermMap] = useState<Record<string, PagePermissions>>({})
  const [permSaving, setPermSaving] = useState<Record<string, boolean>>({})
  const [permMsg, setPermMsg] = useState<Record<string, string>>({})

  // Initialize permMap when users are loaded
  function syncPermMap(list: User[]) {
    setPermMap(() => {
      const next: Record<string, PagePermissions> = {}
      for (const u of list) {
        next[u.id] = buildPermissionsSnapshot(u.permissions)
      }
      return next
    })
  }

  function togglePerm(userId: string, key: keyof PagePermissions) {
    setPermMap((prev) => ({
      ...prev,
      [userId]: { ...prev[userId], [key]: !prev[userId]?.[key] },
    }))
  }

  async function savePerms(userId: string) {
    setPermSaving((s) => ({ ...s, [userId]: true }))
    setPermMsg((m) => ({ ...m, [userId]: "" }))
    const permissions = buildPermissionsSnapshot(permMap[userId])
    const res = await authService.updatePermissions(userId, permissions)
    setPermSaving((s) => ({ ...s, [userId]: false }))
    if (res.success) {
      setPermMap((prev) => ({ ...prev, [userId]: permissions }))
    }
    setPermMsg((m) => ({ ...m, [userId]: res.success ? "已保存" : res.error || "保存失败" }))
  }

  // Upload MOM report
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)

  async function handleUpload() {
    setUploadMsg(null)
    if (!file) { setUploadMsg("请选择要上传的 report.html 文件"); return }
    try {
      setUploading(true)
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/admin/upload-report", { method: "POST", body: fd })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        setUploadMsg(`上传失败：${data?.error || res.statusText}`)
        return
      }
      setUploadMsg("上传成功！")
    } catch (e: any) {
      setUploadMsg(`上传异常：${e?.message || e}`)
    } finally {
      setUploading(false)
    }
  }

  if (!authorized) {
    return (
      <div className="min-h-screen bg-black text-cyan-300 flex items-center justify-center">
        <Card className="bg-black/60 border border-cyan-500/30 backdrop-blur-md p-6">
          <div className="text-lg">无权限访问管理员页面</div>
          <div className="mt-4 flex gap-3">
            <Button variant="outline" className="border-cyan-500/50 text-cyan-300" onClick={() => router.push("/dashboard")}>返回仪表盘</Button>
            <Button variant="secondary" onClick={() => router.push("/login")}>前往登录</Button>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-black to-[#0a0f1e] text-cyan-300">
      <div className="sticky top-0 z-10 bg-black/60 backdrop-blur border-b border-cyan-500/30">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="text-xl font-semibold">管理员：账户管理</div>
          <Button className="bg-cyan-600 hover:bg-cyan-500" onClick={() => router.push("/dashboard")}>返回仪表盘</Button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-8">
        <Card className="bg-black/60 border border-cyan-500/30 backdrop-blur-md p-6">
          <div className="text-lg font-medium">新增用户</div>
          <Separator className="my-4 bg-cyan-500/30" />
          {error && <div className="text-red-400 mb-3">{error}</div>}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <Input placeholder="姓名" value={newName} onChange={(e) => setNewName(e.target.value)} className="bg-black/40 border-cyan-500/30 text-cyan-200 placeholder-cyan-700" />
            <Input placeholder="邮箱" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="bg-black/40 border-cyan-500/30 text-cyan-200 placeholder-cyan-700" />
            <Input placeholder="密码" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="bg-black/40 border-cyan-500/30 text-cyan-200 placeholder-cyan-700" />
            <div className="flex items-center gap-2">
              <Button variant={newRole === "user" ? "default" : "outline"} className="bg-cyan-600/70 hover:bg-cyan-500/70" onClick={() => setNewRole("user")}>普通用户</Button>
              <Button variant={newRole === "admin" ? "default" : "outline"} className="bg-cyan-600/70 hover:bg-cyan-500/70" onClick={() => setNewRole("admin")}>管理员</Button>
            </div>
          </div>
          <div className="mt-4">
            <Button onClick={handleAdd} className="bg-cyan-600 hover:bg-cyan-500">添加用户</Button>
          </div>
        </Card>

        <Card className="bg-black/60 border border-cyan-500/30 backdrop-blur-md p-6">
          <div className="text-lg font-medium">MOM 报告上传</div>
          <Separator className="my-4 bg-cyan-500/30" />
          <div className="grid gap-3 md:grid-cols-3 items-center">
            <div className="md:col-span-3 flex flex-col gap-2">
              <Label className="text-cyan-300">选择新的 report.html</Label>
              <Input type="file" accept=".html,text/html" onChange={(e) => setFile(e.target.files?.[0] || null)} className="bg-black/40 border-cyan-500/30 text-cyan-200" />
              <div className="text-xs text-cyan-500/70">上传后将替换 /public/mom_report/report.html，服务器将自动备份旧文件。</div>
            </div>
            <div className="flex items-end"><Button disabled={uploading} onClick={handleUpload} className="bg-cyan-600 hover:bg-cyan-500 mt-2">{uploading ? "上传中..." : "上传报告"}</Button></div>
          </div>
          {uploadMsg && (
            <div className={cn("mt-3 text-sm", uploadMsg.includes("成功") ? "text-green-400" : "text-red-400")}>{uploadMsg}</div>
          )}
          <div className="mt-3 text-sm">
            预览：<a className="underline" href="/mom_report/report.html" target="_blank" rel="noopener noreferrer">/mom_report/report.html</a>
          </div>
        </Card>

        <Card className="bg-black/60 border border-cyan-500/30 backdrop-blur-md p-6">
          <div className="flex items-center justify-between">
            <div className="text-lg font-medium">AI Token 用量统计</div>
            <Button variant="outline" className="border-cyan-500/50 text-cyan-300 text-xs" onClick={refreshTokenStats} disabled={tokenLoading}>
              {tokenLoading ? "刷新中..." : "刷新"}
            </Button>
          </div>
          <Separator className="my-4 bg-cyan-500/30" />
          {tokenLoading ? (
            <div className="text-cyan-500">加载中...</div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
                <div className="bg-black/40 border border-cyan-500/20 rounded p-3">
                  <div className="text-xs text-cyan-500 mb-1">累计总 Token</div>
                  <div className="text-xl font-bold text-cyan-300">{totalTokens.toLocaleString()}</div>
                </div>
                <div className="bg-black/40 border border-cyan-500/20 rounded p-3">
                  <div className="text-xs text-cyan-500 mb-1">累计请求次数</div>
                  <div className="text-xl font-bold text-cyan-300">{totalRequests.toLocaleString()}</div>
                </div>
                <div className="bg-black/40 border border-cyan-500/20 rounded p-3">
                  <div className="text-xs text-cyan-500 mb-1">活跃用户数</div>
                  <div className="text-xl font-bold text-cyan-300">{tokenStats.length}</div>
                </div>
                <div className="bg-black/40 border border-cyan-500/20 rounded p-3">
                  <div className="text-xs text-cyan-500 mb-1">均每次 Token</div>
                  <div className="text-xl font-bold text-cyan-300">
                    {totalRequests > 0 ? Math.round(totalTokens / totalRequests).toLocaleString() : "—"}
                  </div>
                </div>
              </div>

              {tokenStats.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-cyan-400">用户</TableHead>
                      <TableHead className="text-cyan-400 text-right">请求次数</TableHead>
                      <TableHead className="text-cyan-400 text-right">输入 Token</TableHead>
                      <TableHead className="text-cyan-400 text-right">输出 Token</TableHead>
                      <TableHead className="text-cyan-400 text-right">合计 Token</TableHead>
                      <TableHead className="text-cyan-400">最后使用</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tokenStats.map((s) => (
                      <TableRow key={s.userId}>
                        <TableCell className="text-cyan-200 font-medium">{s.userName}</TableCell>
                        <TableCell className="text-cyan-200 text-right">{s.requestCount.toLocaleString()}</TableCell>
                        <TableCell className="text-cyan-200 text-right">{s.inputTokens.toLocaleString()}</TableCell>
                        <TableCell className="text-cyan-200 text-right">{s.outputTokens.toLocaleString()}</TableCell>
                        <TableCell className="text-cyan-300 text-right font-semibold">{s.totalTokens.toLocaleString()}</TableCell>
                        <TableCell className="text-cyan-500 text-xs">{new Date(s.lastUsed).toLocaleString("zh-CN")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {tokenStats.length === 0 && (
                <div className="text-cyan-600 text-sm">暂无数据，当用户使用 AI 知识库问答后将自动记录。</div>
              )}

              <div className="mt-4">
                <button
                  className="text-xs text-cyan-500 underline hover:text-cyan-300"
                  onClick={() => setShowRecentRecords((v) => !v)}
                >
                  {showRecentRecords ? "折叠最近记录" : `查看最近 ${recentRecords.length} 条请求记录`}
                </button>
              </div>

              {showRecentRecords && recentRecords.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-cyan-400">时间</TableHead>
                        <TableHead className="text-cyan-400">用户</TableHead>
                        <TableHead className="text-cyan-400">模型</TableHead>
                        <TableHead className="text-cyan-400 text-right">输入</TableHead>
                        <TableHead className="text-cyan-400 text-right">输出</TableHead>
                        <TableHead className="text-cyan-400 text-right">合计</TableHead>
                        <TableHead className="text-cyan-400">问题预览</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recentRecords.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="text-cyan-500 text-xs whitespace-nowrap">{new Date(r.timestamp).toLocaleString("zh-CN")}</TableCell>
                          <TableCell className="text-cyan-200">{r.userName}</TableCell>
                          <TableCell className="text-cyan-500 text-xs">{r.model}</TableCell>
                          <TableCell className="text-cyan-200 text-right">{r.inputTokens.toLocaleString()}</TableCell>
                          <TableCell className="text-cyan-200 text-right">{r.outputTokens.toLocaleString()}</TableCell>
                          <TableCell className="text-cyan-300 text-right font-semibold">{r.totalTokens.toLocaleString()}</TableCell>
                          <TableCell className="text-cyan-400 text-xs max-w-xs truncate">{r.questionPreview}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}
        </Card>

        <Card className="bg-black/60 border border-cyan-500/30 backdrop-blur-md p-6">
          <div className="text-lg font-medium">页面访问权限管理</div>
          <Separator className="my-4 bg-cyan-500/30" />
          <div className="text-xs text-cyan-500/70 mb-4">管理员账号默认拥有全部权限，以下设置仅对普通用户生效。</div>
          {loading ? (
            <div className="text-cyan-500">加载中...</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-cyan-400">用户</TableHead>
                    {PERM_COLUMNS.map((col) => (
                      <TableHead key={col.key} className="text-cyan-400 text-center min-w-[7rem]">
                        <div>{col.label}</div>
                        {col.hint && <div className="text-[10px] font-normal text-cyan-500/60 mt-0.5">{col.hint}</div>}
                      </TableHead>
                    ))}
                    <TableHead className="text-cyan-400">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => {
                    const perms = permMap[u.id] ?? {}
                    const isAdmin = u.role === "admin"
                    return (
                      <TableRow key={u.id}>
                        <TableCell className="text-cyan-200 font-medium">
                          {u.name}
                          {isAdmin && <span className="ml-2 text-xs text-cyan-500">（管理员）</span>}
                        </TableCell>
                        {PERM_COLUMNS.map((col) => (
                          <TableCell key={col.key} className="text-center">
                            <Checkbox
                              disabled={isAdmin}
                              checked={isAdmin || !!perms[col.key]}
                              onCheckedChange={() => togglePerm(u.id, col.key)}
                              className="border-cyan-500/50 data-[state=checked]:bg-cyan-600"
                            />
                          </TableCell>
                        ))}
                        <TableCell>
                          {!isAdmin && (
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                className="bg-cyan-600 hover:bg-cyan-500"
                                disabled={!!permSaving[u.id]}
                                onClick={() => savePerms(u.id)}
                              >
                                {permSaving[u.id] ? "保存中..." : "保存"}
                              </Button>
                              {permMsg[u.id] && (
                                <span className={cn("text-xs", permMsg[u.id] === "已保存" ? "text-green-400" : "text-red-400")}>
                                  {permMsg[u.id]}
                                </span>
                              )}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>

        <Card className="bg-black/60 border border-cyan-500/30 backdrop-blur-md p-6">
          <div className="text-lg font-medium">用户列表</div>
          <Separator className="my-4 bg-cyan-500/30" />
          {loading ? (
            <div>加载中...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-cyan-400">ID</TableHead>
                  <TableHead className="text-cyan-400">姓名</TableHead>
                  <TableHead className="text-cyan-400">邮箱</TableHead>
                  <TableHead className="text-cyan-400">角色</TableHead>
                  <TableHead className="text-cyan-400">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="text-cyan-200">{u.id}</TableCell>
                    <TableCell className="text-cyan-200">
                      {editingId === u.id ? (
                        <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="bg-black/40 border-cyan-500/30 text-cyan-200" />
                      ) : (
                        u.name
                      )}
                    </TableCell>
                    <TableCell className="text-cyan-200">
                      {editingId === u.id ? (
                        <Input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} className="bg-black/40 border-cyan-500/30 text-cyan-200" />
                      ) : (
                        u.email
                      )}
                    </TableCell>
                    <TableCell className="text-cyan-200">
                      {editingId === u.id ? (
                        <div className="flex gap-2">
                          <Button variant={editRole === "user" ? "default" : "outline"} className="bg-cyan-600/70 hover:bg-cyan-500/70" onClick={() => setEditRole("user")}>普通</Button>
                          <Button variant={editRole === "admin" ? "default" : "outline"} className="bg-cyan-600/70 hover:bg-cyan-500/70" onClick={() => setEditRole("admin")}>管理员</Button>
                        </div>
                      ) : (
                        u.role === "admin" ? "管理员" : "普通用户"
                      )}
                    </TableCell>
                    <TableCell className="text-cyan-200">
                      {editingId === u.id ? (
                        <div className="flex items-center gap-2">
                          <Input placeholder="新密码(可选)" type="password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} className="bg-black/40 border-cyan-500/30 text-cyan-200 w-40" />
                          <Button onClick={handleSaveEdit} className="bg-cyan-600 hover:bg-cyan-500">保存</Button>
                          <Button variant="outline" className="border-cyan-500/50 text-cyan-300" onClick={cancelEdit}>取消</Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Button variant="outline" className="border-cyan-500/50 text-cyan-300" onClick={() => startEdit(u)}>编辑</Button>
                          <Button variant="destructive" onClick={() => handleDelete(u.id)}>删除</Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  )
}
