"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { authService, User } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"

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

  useEffect(() => {
    authService.init()
    const isAdmin = authService.isAdmin()
    setAuthorized(isAdmin)
    if (!isAdmin) {
      setLoading(false)
      return
    }
    refreshUsers()
  }, [])

  async function refreshUsers() {
    setLoading(true)
    const list = await authService.listUsers()
    setUsers(list)
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
