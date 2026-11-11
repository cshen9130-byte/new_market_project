/**
 * Shared 基金经理观点 templates and per-product assignments for team 持仓版周报.
 * Stored under auto-weekly-reports so every computer sees the same content.
 */
import { randomUUID } from "crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"
import { getServerStoragePath } from "@/lib/server/storage"

export const MANAGER_VIEW_MAX_LENGTH = 800

export type ManagerViewTemplate = {
  id: string
  name: string
  text: string
  createdAt: string
  updatedAt: string
}

export type ManagerViewAssignment = {
  product_name: string
  beian_hao: string | null
  text: string
  templateId: string | null
  updatedAt: string
}

type ManagerViewsFile = {
  version: 1
  updatedAt: string
  templates: ManagerViewTemplate[]
  assignments: ManagerViewAssignment[]
}

function storeDir(): string {
  return getServerStoragePath("auto-weekly-reports")
}

function storePath(): string {
  return path.join(storeDir(), "manager-views.json")
}

function productKey(product_name: string, beian_hao: string | null | undefined): string {
  const code = (beian_hao || "").trim().toUpperCase()
  if (code) return `code:${code}`
  return `name:${(product_name || "").trim()}`
}

function clipView(text: string | null | undefined): string {
  return String(text ?? "").trim().slice(0, MANAGER_VIEW_MAX_LENGTH)
}

function emptyStore(): ManagerViewsFile {
  return { version: 1, updatedAt: new Date().toISOString(), templates: [], assignments: [] }
}

function readStore(): ManagerViewsFile {
  mkdirSync(storeDir(), { recursive: true })
  const file = storePath()
  if (!existsSync(file)) return emptyStore()
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as ManagerViewsFile
    if (!parsed || !Array.isArray(parsed.templates) || !Array.isArray(parsed.assignments)) {
      return emptyStore()
    }
    return {
      version: 1,
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      templates: parsed.templates,
      assignments: parsed.assignments,
    }
  } catch {
    return emptyStore()
  }
}

function writeStore(data: ManagerViewsFile): void {
  mkdirSync(storeDir(), { recursive: true })
  data.updatedAt = new Date().toISOString()
  writeFileSync(storePath(), JSON.stringify(data, null, 2), "utf8")
}

export function listManagerViewTemplates(): ManagerViewTemplate[] {
  return readStore().templates.slice().sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
}

export function listManagerViewAssignments(): ManagerViewAssignment[] {
  return readStore().assignments.slice()
}

export function getAssignedManagerView(
  product_name: string,
  beian_hao?: string | null,
): { text: string; templateId: string | null } {
  const data = readStore()
  const keys = [
    productKey(product_name, beian_hao),
    productKey(product_name, null),
  ]
  const seen = new Set<string>()
  for (const key of keys) {
    if (seen.has(key)) continue
    seen.add(key)
    const hit = data.assignments.find((row) => productKey(row.product_name, row.beian_hao) === key)
    if (hit) return { text: clipView(hit.text), templateId: hit.templateId }
  }
  return { text: "", templateId: null }
}

export function upsertManagerViewTemplate(input: {
  id?: string
  name: string
  text: string
}): ManagerViewTemplate {
  const name = String(input.name || "").trim().slice(0, 80)
  if (!name) throw new Error("请填写模板名称")
  const text = clipView(input.text)
  if (!text) throw new Error("请填写观点内容")
  const now = new Date().toISOString()
  const data = readStore()
  const id = (input.id || "").trim()
  const existing = id ? data.templates.find((row) => row.id === id) : undefined
  const sameName = data.templates.find((row) => row.name === name && row.id !== existing?.id)
  if (sameName) throw new Error("已有同名模板")
  if (existing) {
    existing.name = name
    existing.text = text
    existing.updatedAt = now
    writeStore(data)
    return existing
  }
  const row: ManagerViewTemplate = {
    id: `mvt_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    name,
    text,
    createdAt: now,
    updatedAt: now,
  }
  data.templates.unshift(row)
  writeStore(data)
  return row
}

export function deleteManagerViewTemplate(id: string): boolean {
  const tid = (id || "").trim()
  if (!tid) return false
  const data = readStore()
  const next = data.templates.filter((row) => row.id !== tid)
  if (next.length === data.templates.length) return false
  data.templates = next
  for (const row of data.assignments) {
    if (row.templateId === tid) row.templateId = null
  }
  writeStore(data)
  return true
}

export function assignManagerViews(
  products: Array<{ product_name: string; beian_hao?: string | null }>,
  text: string,
  templateId?: string | null,
): { updated: number } {
  const view = clipView(text)
  const tid = (templateId || "").trim() || null
  const now = new Date().toISOString()
  const data = readStore()
  const indexByKey = new Map(
    data.assignments.map((row, index) => [productKey(row.product_name, row.beian_hao), index] as const),
  )
  let updated = 0
  for (const product of products) {
    const product_name = (product.product_name || "").trim()
    if (!product_name) continue
    const beian_hao = (product.beian_hao || "").trim() || null
    const key = productKey(product_name, beian_hao)
    const row: ManagerViewAssignment = {
      product_name,
      beian_hao,
      text: view,
      templateId: tid,
      updatedAt: now,
    }
    const existing = indexByKey.get(key)
    if (existing == null) {
      indexByKey.set(key, data.assignments.length)
      data.assignments.push(row)
    } else {
      data.assignments[existing] = row
    }
    updated += 1
  }
  if (updated === 0) throw new Error("请选择要应用的产品")
  writeStore(data)
  return { updated }
}

export type ManagerViewsSnapshot = {
  templates: ManagerViewTemplate[]
  assignments: ManagerViewAssignment[]
  updatedAt: string
}

export function getManagerViewsSnapshot(): ManagerViewsSnapshot {
  const data = readStore()
  return {
    templates: listManagerViewTemplates(),
    assignments: data.assignments,
    updatedAt: data.updatedAt,
  }
}
