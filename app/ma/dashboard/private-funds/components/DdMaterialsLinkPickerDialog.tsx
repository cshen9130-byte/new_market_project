"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Loader2, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { DD_MATERIALS_KB_ROOT } from "@/lib/ma/due-diligence-materials"

type KbTreeNode = {
  name: string
  relativePath: string
  folders: KbTreeNode[]
  documents: Array<{
    name: string
    relativePath: string
    extension: string
    size: number
    updatedAt: string
  }>
}

type SearchEntry =
  | { kind: "folder"; name: string; relativePath: string }
  | {
      kind: "file"
      name: string
      relativePath: string
      parentPath: string
    }

function findFolderNode(tree: KbTreeNode | null, targetPath: string): KbTreeNode | null {
  if (!tree) return null
  if (tree.relativePath === targetPath) return tree
  for (const child of tree.folders) {
    const found = findFolderNode(child, targetPath)
    if (found) return found
  }
  return null
}

function findDdMaterialsRoot(tree: KbTreeNode | null): KbTreeNode | null {
  if (!tree) return null
  if (tree.relativePath === DD_MATERIALS_KB_ROOT || tree.name === DD_MATERIALS_KB_ROOT) return tree
  for (const child of tree.folders) {
    const found = findDdMaterialsRoot(child)
    if (found) return found
  }
  return null
}

function collectSearchEntries(root: KbTreeNode): SearchEntry[] {
  const entries: SearchEntry[] = []
  function walk(node: KbTreeNode) {
    entries.push({ kind: "folder", name: node.name, relativePath: node.relativePath })
    for (const doc of node.documents) {
      entries.push({
        kind: "file",
        name: doc.name,
        relativePath: doc.relativePath,
        parentPath: node.relativePath,
      })
    }
    for (const child of node.folders) walk(child)
  }
  walk(root)
  return entries
}

function folderPathsToExpand(targetPath: string): string[] {
  if (!targetPath) return []
  const parts = targetPath.split("/").filter(Boolean)
  const paths: string[] = []
  for (let i = 0; i < parts.length; i++) {
    paths.push(parts.slice(0, i + 1).join("/"))
  }
  return paths
}

function matchesSearch(entry: SearchEntry, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    entry.name.toLowerCase().includes(q)
    || entry.relativePath.toLowerCase().includes(q)
  )
}

function FolderTree({
  node,
  depth,
  selectedFolderPath,
  onSelectFolder,
  expanded,
  onToggle,
}: {
  node: KbTreeNode
  depth: number
  selectedFolderPath: string | null
  onSelectFolder: (path: string) => void
  expanded: Set<string>
  onToggle: (path: string) => void
}) {
  const isExpanded = expanded.has(node.relativePath)
  const isSelected = selectedFolderPath === node.relativePath
  return (
    <div>
      <div
        className={cn(
          "flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-sm select-none hover:bg-accent",
          isSelected && "bg-accent font-medium",
        )}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => onSelectFolder(node.relativePath)}
      >
        <button
          type="button"
          className="flex h-4 w-4 shrink-0 items-center justify-center"
          onClick={(event) => {
            event.stopPropagation()
            if (node.folders.length > 0) onToggle(node.relativePath)
          }}
        >
          {node.folders.length > 0
            ? (isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />)
            : null}
        </button>
        {isExpanded
          ? <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" />
          : <Folder className="h-4 w-4 shrink-0 text-amber-500" />}
        <span className="truncate">{node.name}</span>
      </div>
      {isExpanded && node.folders.map((child) => (
        <FolderTree
          key={child.relativePath}
          node={child}
          depth={depth + 1}
          selectedFolderPath={selectedFolderPath}
          onSelectFolder={onSelectFolder}
          expanded={expanded}
          onToggle={onToggle}
        />
      ))}
    </div>
  )
}

export function DdMaterialsLinkPickerDialog({
  open,
  onOpenChange,
  initialPath,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialPath?: string | null
  onConfirm: (kbPath: string) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [tree, setTree] = useState<KbTreeNode | null>(null)
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(null)
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set([DD_MATERIALS_KB_ROOT]))
  const [searchQuery, setSearchQuery] = useState("")

  const ddRoot = useMemo(() => findDdMaterialsRoot(tree), [tree])
  const searchEntries = useMemo(() => (ddRoot ? collectSearchEntries(ddRoot) : []), [ddRoot])
  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim()
    if (!q) return []
    return searchEntries.filter((entry) => matchesSearch(entry, q)).slice(0, 80)
  }, [searchEntries, searchQuery])
  const isSearching = searchQuery.trim().length > 0

  const selectedFolder = useMemo(
    () => (selectedFolderPath ? findFolderNode(tree, selectedFolderPath) : null),
    [selectedFolderPath, tree],
  )

  const selectedPath = selectedFilePath ?? selectedFolderPath

  const loadTree = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const headers: Record<string, string> = {}
      try {
        const raw = localStorage.getItem("currentUser")
        if (raw) {
          const user = JSON.parse(raw) as { id?: string }
          if (user.id?.trim()) headers["x-market-user-id"] = user.id.trim()
        }
      } catch {
        // ignore
      }
      const res = await fetch("/api/knowledge-base/tree", { headers })
      const data = await res.json()
      if (!res.ok || !data?.ok) throw new Error(data?.error || res.statusText)
      setTree(data.tree ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载知识库失败")
      setTree(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void loadTree()
  }, [loadTree, open])

  useEffect(() => {
    if (!open) {
      setSearchQuery("")
      return
    }
    if (!ddRoot) return
    const initial = initialPath?.trim() || ""
    if (!initial) {
      setSelectedFolderPath(ddRoot.relativePath)
      setSelectedFilePath(null)
      return
    }
    const folderNode = findFolderNode(tree, initial)
    if (folderNode) {
      setSelectedFolderPath(folderNode.relativePath)
      setSelectedFilePath(null)
      setExpanded(new Set(folderPathsToExpand(folderNode.relativePath)))
      return
    }
    const parent = initial.includes("/") ? initial.replace(/\/[^/]+$/u, "") : DD_MATERIALS_KB_ROOT
    setSelectedFolderPath(parent)
    setSelectedFilePath(initial)
    setExpanded(new Set(folderPathsToExpand(parent)))
  }, [ddRoot, initialPath, open, tree])

  function handleToggle(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function handleSelectFolder(path: string) {
    setSelectedFolderPath(path)
    setSelectedFilePath(null)
  }

  function navigateToEntry(entry: SearchEntry) {
    if (entry.kind === "folder") {
      setSelectedFolderPath(entry.relativePath)
      setSelectedFilePath(null)
      setExpanded(new Set(folderPathsToExpand(entry.relativePath)))
    } else {
      setSelectedFolderPath(entry.parentPath)
      setSelectedFilePath(entry.relativePath)
      setExpanded(new Set(folderPathsToExpand(entry.parentPath)))
    }
    setSearchQuery("")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="px-4 pb-2 pt-4">
          <DialogTitle>手动关联尽调资料</DialogTitle>
          <p className="text-xs text-muted-foreground pt-1">
            搜索或浏览「{DD_MATERIALS_KB_ROOT}」下的文件夹与文件。
          </p>
        </DialogHeader>

        {!loading && !error && ddRoot && (
          <div className="px-4 pb-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索文件夹或文件名…"
                className="h-8 pl-8 text-sm"
              />
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 border-y px-4 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在加载知识库…
          </div>
        ) : error ? (
          <div className="border-y px-4 py-10 text-sm text-red-600">{error}</div>
        ) : !ddRoot ? (
          <div className="border-y px-4 py-10 text-sm text-muted-foreground">
            未找到「{DD_MATERIALS_KB_ROOT}」目录。
          </div>
        ) : isSearching ? (
          <ScrollArea className="border-y px-2 py-2" style={{ maxHeight: "52vh" }}>
            {filteredEntries.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">未找到匹配的文件夹或文件</div>
            ) : (
              <div className="divide-y">
                {filteredEntries.map((entry) => {
                  const active =
                    entry.kind === "folder"
                      ? selectedFolderPath === entry.relativePath && !selectedFilePath
                      : selectedFilePath === entry.relativePath
                  return (
                    <button
                      key={`${entry.kind}:${entry.relativePath}`}
                      type="button"
                      onClick={() => navigateToEntry(entry)}
                      className={cn(
                        "flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted/40",
                        active && "bg-blue-50/70",
                      )}
                    >
                      {entry.kind === "folder" ? (
                        <Folder className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                      ) : (
                        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium" title={entry.name}>
                          {entry.name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground" title={entry.relativePath}>
                          {entry.relativePath}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </ScrollArea>
        ) : (
          <div className="flex min-h-0 flex-1 border-y">
            <ScrollArea className="w-[44%] border-r px-2 py-2" style={{ maxHeight: "52vh" }}>
              <FolderTree
                node={ddRoot}
                depth={0}
                selectedFolderPath={selectedFolderPath}
                onSelectFolder={handleSelectFolder}
                expanded={expanded}
                onToggle={handleToggle}
              />
            </ScrollArea>
            <ScrollArea className="flex-1 px-2 py-2" style={{ maxHeight: "52vh" }}>
              {!selectedFolder ? (
                <div className="p-4 text-sm text-muted-foreground">请选择左侧文件夹</div>
              ) : selectedFolder.documents.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">
                  该文件夹暂无文件，可直接关联整个文件夹。
                </div>
              ) : (
                <div className="divide-y">
                  {selectedFolder.documents.map((doc) => {
                    const active = selectedFilePath === doc.relativePath
                    return (
                      <button
                        key={doc.relativePath}
                        type="button"
                        onClick={() => {
                          setSelectedFolderPath(selectedFolder.relativePath)
                          setSelectedFilePath(doc.relativePath)
                        }}
                        className={cn(
                          "flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-muted/40",
                          active && "bg-blue-50/70",
                        )}
                      >
                        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                        <span className="min-w-0 truncate" title={doc.name}>
                          {doc.name}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </ScrollArea>
          </div>
        )}

        <div className="px-4 py-2 text-xs text-muted-foreground truncate border-t bg-muted/10">
          {selectedPath ? `已选：${selectedPath}` : "尚未选择"}
        </div>

        <DialogFooter className="px-4 py-3">
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            size="sm"
            disabled={!selectedPath}
            onClick={() => {
              if (!selectedPath) return
              onConfirm(selectedPath)
              onOpenChange(false)
            }}
          >
            确认关联
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
