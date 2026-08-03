"use client"

import { useMemo } from "react"
import {
  FileArchive,
  FileCode,
  File as FileIcon,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FolderOpen,
} from "lucide-react"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { cn } from "@/lib/utils"

export type KnowledgeBaseSearchDocument = {
  name: string
  relativePath: string
  extension: string
  size: number
}

type KnowledgeBaseFileSearchDialogProps<T extends KnowledgeBaseSearchDocument = KnowledgeBaseSearchDocument> = {
  open: boolean
  onOpenChange: (open: boolean) => void
  documents: T[]
  onSelectDocument: (document: T) => void
  onOpenContainingFolder: (document: T) => void
}

function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "—"
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function getFileIcon(extension: string) {
  const normalized = extension.toLowerCase()

  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".avif"].includes(normalized)) {
    return { icon: FileImage, className: "bg-emerald-500/15 text-emerald-500" }
  }
  if ([".xls", ".xlsx", ".csv", ".tsv"].includes(normalized)) {
    return { icon: FileSpreadsheet, className: "bg-green-500/15 text-green-600" }
  }
  if ([".json"].includes(normalized)) {
    return { icon: FileJson, className: "bg-amber-500/15 text-amber-600" }
  }
  if ([".ts", ".tsx", ".js", ".jsx", ".html", ".htm", ".xml", ".md", ".markdown"].includes(normalized)) {
    return { icon: FileCode, className: "bg-sky-500/15 text-sky-600" }
  }
  if ([".zip", ".rar", ".7z"].includes(normalized)) {
    return { icon: FileArchive, className: "bg-violet-500/15 text-violet-600" }
  }
  if ([".pdf", ".doc", ".docx", ".txt", ".log"].includes(normalized)) {
    return { icon: FileText, className: "bg-rose-500/15 text-rose-500" }
  }
  return { icon: FileIcon, className: "bg-muted text-muted-foreground" }
}

function getFolderPath(relativePath: string): string {
  const slashIndex = relativePath.lastIndexOf("/")
  return slashIndex >= 0 ? relativePath.slice(0, slashIndex) : "根目录"
}

export function KnowledgeBaseFileSearchDialog<T extends KnowledgeBaseSearchDocument>({
  open,
  onOpenChange,
  documents,
  onSelectDocument,
  onOpenContainingFolder,
}: KnowledgeBaseFileSearchDialogProps<T>) {
  const sortedDocuments = useMemo(
    () => [...documents].sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
    [documents],
  )

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="搜索知识库文件"
      description="按文件名或路径搜索，并快速打开文件"
      className="sm:max-w-2xl"
    >
      <CommandInput placeholder="输入文件名或路径…" />
      <CommandList className="max-h-[420px]">
        <CommandEmpty>未找到匹配的文件</CommandEmpty>
        <CommandGroup heading={`共 ${sortedDocuments.length} 个文件`}>
          {sortedDocuments.map((document) => {
            const { icon: Icon, className } = getFileIcon(document.extension)
            return (
              <ContextMenu key={document.relativePath}>
                <ContextMenuTrigger asChild>
                  <CommandItem
                    value={`${document.name} ${document.relativePath}`}
                    onSelect={() => onSelectDocument(document)}
                  >
                    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", className)}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{document.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {getFolderPath(document.relativePath)} · {formatFileSize(document.size)}
                      </span>
                    </span>
                  </CommandItem>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-48">
                  <ContextMenuItem onSelect={() => onOpenContainingFolder(document)}>
                    <FolderOpen className="h-4 w-4" />
                    打开所在文件夹
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            )
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
