/**
 * Pull the latest 周度业绩 folder from the ima knowledge base 点睛焱究所
 * into 外部私募业绩排行/ima点睛.
 */

import { mkdir, writeFile } from "fs/promises"
import path from "path"
import { IMA_DIANJING_RANK_FOLDER } from "@/lib/ma/external-rank-week"
import { getKnowledgeBaseStorageRoot } from "@/lib/server/knowledge-base"
import { imaPost } from "@/lib/server/ima-openapi"

const KB_NAME = "点睛焱究所"
const SECTION_HINT = "周度业绩排名"
const WEEKLY_FOLDER = "周度业绩"

type KbHit = {
  kb_id?: string
  id?: string
  kb_name?: string
  name?: string
}

type ListedItem = {
  title?: string
  name?: string
  media_id?: string
  folder_id?: string
  media_type?: number
}

type ListData = {
  knowledge_list?: ListedItem[]
  is_end?: boolean
  next_cursor?: string
}

type MediaInfo = {
  url_info?: {
    url?: string
    headers?: Record<string, string>
  }
}

export type ImaDianjingRankResult = {
  knowledgeBase: string
  folder: string
  weekEnd: string
  saved: string[]
  bytes: number
}

function shanghaiToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

function toIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const dt = new Date(Date.UTC(year, month - 1, day))
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function addDays(iso: string, days: number): string {
  const dt = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

/** End date of a folder named MMDD-MMDD. A date more than two weeks ahead is last year. */
export function weekFolderEndIso(name: string, today: string): string | null {
  const match = /^(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(name.trim())
  if (!match) return null
  const year = Number(today.slice(0, 4))
  const month = Number(match[3])
  const day = Number(match[4])
  let iso = toIso(year, month, day)
  if (!iso) return null
  if (iso > addDays(today, 14)) iso = toIso(year - 1, month, day)
  return iso
}

export function pickLatestWeekFolder<T extends { name: string }>(folders: T[], today: string): T | null {
  let best: T | null = null
  let bestEnd = ""
  for (const folder of folders) {
    const end = weekFolderEndIso(folder.name, today)
    if (!end || end <= bestEnd) continue
    best = folder
    bestEnd = end
  }
  return best
}

function itemName(item: ListedItem): string {
  return (item.title || item.name || "").trim()
}

function itemId(item: ListedItem): string {
  return item.media_id || item.folder_id || ""
}

async function listFolder(kbId: string, folderId?: string): Promise<ListedItem[]> {
  const items: ListedItem[] = []
  let cursor = ""
  for (let page = 0; page < 20; page++) {
    const body: Record<string, unknown> = {
      knowledge_base_id: kbId,
      cursor,
      limit: 50,
    }
    if (folderId) body.folder_id = folderId
    const data = await imaPost<ListData>("openapi/wiki/v1/get_knowledge_list", body)
    items.push(...(data.knowledge_list || []))
    if (data.is_end || !data.next_cursor) break
    cursor = data.next_cursor
  }
  return items
}

async function findKnowledgeBaseId(): Promise<string> {
  const data = await imaPost<{ info_list?: KbHit[] }>("openapi/wiki/v1/search_knowledge_base", {
    query: KB_NAME,
    cursor: "",
    limit: 20,
  })
  const list = data.info_list || []
  const hit = list.find((item) => (item.kb_name || item.name || "").trim() === KB_NAME) || list[0]
  const id = hit?.kb_id || hit?.id || ""
  if (!id) throw new Error(`ima 里没有找到知识库「${KB_NAME}」`)
  return id
}

function safeWorkbookName(name: string): string | null {
  const base = name.split(/[/\\]/).pop()?.trim() || ""
  if (!/\.xlsx$/i.test(base)) return null
  const cleaned = base.replace(/[<>:"|?*]/g, "_").replace(/\s+/g, " ").trim()
  return cleaned || null
}

async function downloadMedia(mediaId: string, fileName: string): Promise<Buffer> {
  const info = await imaPost<MediaInfo>("openapi/wiki/v1/get_media_info", { media_id: mediaId })
  const url = info.url_info?.url
  if (!url) throw new Error(`「${fileName}」没有下载地址`)
  const downloadUrl = new URL(url)
  downloadUrl.searchParams.set("response-content-type", "application/octet-stream")
  downloadUrl.searchParams.set("response-content-disposition", `attachment;filename="${fileName}"`)
  const response = await fetch(downloadUrl, { headers: info.url_info?.headers || {} })
  if (!response.ok) throw new Error(`「${fileName}」下载失败（HTTP ${response.status}）`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length < 4 || buffer.subarray(0, 2).toString("hex") !== "504b") {
    throw new Error(`「${fileName}」不是有效的 Excel 文件`)
  }
  return buffer
}

export async function runImaDianjingRankEtl(today = shanghaiToday()): Promise<ImaDianjingRankResult> {
  const kbId = await findKnowledgeBaseId()
  const root = await listFolder(kbId)
  const section = root.find((item) => item.media_type === 99 && itemName(item).includes(SECTION_HINT))
  if (!section) throw new Error(`「${KB_NAME}」里没有「${SECTION_HINT}」文件夹`)
  const sectionItems = await listFolder(kbId, itemId(section))
  const weekly = sectionItems.find((item) => item.media_type === 99 && itemName(item) === WEEKLY_FOLDER)
  if (!weekly) throw new Error(`「${KB_NAME}」里没有「${WEEKLY_FOLDER}」文件夹`)
  const weekItems = await listFolder(kbId, itemId(weekly))
  const candidates = weekItems
    .filter((item) => item.media_type === 99 && itemName(item) !== "2025")
    .map((item) => ({ name: itemName(item), id: itemId(item) }))
    .filter((item) => item.id)
  const latest = pickLatestWeekFolder(candidates, today)
  if (!latest) throw new Error(`「${WEEKLY_FOLDER}」里没有形如 1116-1120 的周文件夹`)

  const files = await listFolder(kbId, latest.id)
  const workbooks = files
    .map((item) => ({ name: safeWorkbookName(itemName(item)), id: itemId(item) }))
    .filter((item): item is { name: string; id: string } => !!item.name && !!item.id)
  if (workbooks.length === 0) throw new Error(`文件夹「${latest.name}」里没有 Excel 榜单`)

  const destDir = path.join(getKnowledgeBaseStorageRoot(), ...IMA_DIANJING_RANK_FOLDER.split("/"))
  await mkdir(destDir, { recursive: true })
  const saved: string[] = []
  let bytes = 0
  for (const file of workbooks) {
    const buffer = await downloadMedia(file.id, file.name)
    await writeFile(path.join(destDir, file.name), buffer)
    saved.push(file.name)
    bytes += buffer.length
  }
  saved.sort((a, b) => a.localeCompare(b, "zh-CN"))
  return {
    knowledgeBase: KB_NAME,
    folder: latest.name,
    weekEnd: weekFolderEndIso(latest.name, today) || "",
    saved,
    bytes,
  }
}
