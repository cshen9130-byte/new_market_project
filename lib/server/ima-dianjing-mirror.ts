/**
 * Manual history fill for 点睛焱究所 → 周度业绩, except the folder named 2025.
 * Not scheduled. Run only when the user asks for older weeks in the current request.
 * Files land in 外部私募业绩排行/ima点睛. The Wednesday job stays on the latest week.
 * The first “资料获取次数已达上限” stops the run.
 */

import { mkdir, stat, writeFile } from "fs/promises"
import path from "path"
import { IMA_DIANJING_RANK_FOLDER } from "@/lib/ma/external-rank-week"
import { getKnowledgeBaseStorageRoot } from "@/lib/server/knowledge-base"
import { imaPost, isImaDailyFetchCap, isImaRateLimit } from "@/lib/server/ima-openapi"

const KB_NAME = "点睛焱究所"
const SECTION_HINT = "周度业绩排名"
const WEEKLY_FOLDER = "周度业绩"
const INITIAL_GAP_MS = 1200
const MAX_GAP_MS = 5000

type KbHit = { kb_id?: string; id?: string; kb_name?: string; name?: string }

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
  media_type?: number
  url_info?: { url?: string; headers?: Record<string, string> }
}

export type ImaMirrorResult = {
  saved: number
  alreadyThere: number
  skippedFolders: string[]
  noDownload: string[]
  failed: Array<{ path: string; message: string }>
  bytes: number
  rankCopied: number
}

export function isSkippedImaFolderName(name: string): boolean {
  return name.trim() === "2025"
}

export function safePathSegment(name: string): string {
  const cleaned = name.replace(/[<>:"|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "").trim()
  return cleaned || "_"
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

class Pacer {
  private nextAt = 0
  gap: number

  constructor(gap = INITIAL_GAP_MS) {
    this.gap = gap
  }

  async wait(): Promise<void> {
    const now = Date.now()
    if (now < this.nextAt) await sleep(this.nextAt - now)
    this.nextAt = Date.now() + this.gap
  }

  slowDown(): void {
    this.gap = Math.min(MAX_GAP_MS, Math.max(this.gap * 2, 2500))
  }
}

function itemName(item: ListedItem): string {
  return (item.title || item.name || "").trim()
}

function itemId(item: ListedItem): string {
  return item.media_id || item.folder_id || ""
}

function isFolder(item: ListedItem): boolean {
  return item.media_type === 99 || itemId(item).startsWith("folder_")
}

async function pacedPost<T>(pacer: Pacer, apiPath: string, body: unknown): Promise<T> {
  for (let attempt = 0; attempt < 6; attempt++) {
    await pacer.wait()
    try {
      return await imaPost<T>(apiPath, body)
    } catch (err) {
      if (!isImaRateLimit(err) || attempt === 5) throw err
      pacer.slowDown()
      const pause = 20000 * (attempt + 1)
      console.log(`[ima-mirror] rate limit, pause ${pause / 1000}s, gap now ${pacer.gap}ms`)
      await sleep(pause)
    }
  }
  throw new Error("ima 请求在限频后仍未成功")
}

async function findKnowledgeBaseId(pacer: Pacer): Promise<string> {
  const data = await pacedPost<{ info_list?: KbHit[] }>(pacer, "openapi/wiki/v1/search_knowledge_base", {
    query: KB_NAME,
    cursor: "",
    limit: 5,
  })
  const list = data.info_list || []
  const hit = list.find((item) => (item.kb_name || item.name || "").trim() === KB_NAME) || list[0]
  const id = hit?.kb_id || hit?.id || ""
  if (!id) throw new Error(`ima 里没有找到知识库「${KB_NAME}」`)
  return id
}

async function listFolder(pacer: Pacer, kbId: string, folderId?: string): Promise<ListedItem[]> {
  const items: ListedItem[] = []
  let cursor = ""
  for (let page = 0; page < 40; page++) {
    const body: Record<string, unknown> = { knowledge_base_id: kbId, cursor, limit: 50 }
    if (folderId) body.folder_id = folderId
    const data = await pacedPost<ListData>(pacer, "openapi/wiki/v1/get_knowledge_list", body)
    items.push(...(data.knowledge_list || []))
    if (data.is_end || !data.next_cursor) break
    cursor = data.next_cursor
  }
  return items
}

function rankName(fileName: string): string | null {
  if (!/\.xlsx$/i.test(fileName)) return null
  const cleaned = safePathSegment(fileName)
  return /\.xlsx$/i.test(cleaned) ? cleaned : null
}

async function downloadTo(pacer: Pacer, mediaId: string, fileName: string, dest: string): Promise<number> {
  const info = await pacedPost<MediaInfo>(pacer, "openapi/wiki/v1/get_media_info", { media_id: mediaId })
  const url = info.url_info?.url
  if (!url) {
    const err = new Error("no-url")
    ;(err as Error & { noUrl?: boolean }).noUrl = true
    throw err
  }
  const downloadUrl = new URL(url)
  downloadUrl.searchParams.set("response-content-type", "application/octet-stream")
  downloadUrl.searchParams.set("response-content-disposition", `attachment;filename="${fileName}"`)
  const response = await fetch(downloadUrl, { headers: info.url_info?.headers || {} })
  if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length === 0) throw new Error("下载到的文件是空的")
  await mkdir(path.dirname(dest), { recursive: true })
  await writeFile(dest, buffer)
  return buffer.length
}

function logProgress(result: ImaMirrorResult): void {
  console.log(
    `[ima-mirror] saved=${result.saved} existed=${result.alreadyThere} failed=${result.failed.length} noUrl=${result.noDownload.length} bytes=${result.bytes}`,
  )
}

export async function mirrorImaDianjingLibrary(): Promise<ImaMirrorResult> {
  const pacer = new Pacer()
  const kbId = await findKnowledgeBaseId(pacer)
  const rankRoot = path.join(getKnowledgeBaseStorageRoot(), ...IMA_DIANJING_RANK_FOLDER.split("/"))
  await mkdir(rankRoot, { recursive: true })

  const result: ImaMirrorResult = {
    saved: 0,
    alreadyThere: 0,
    skippedFolders: [],
    noDownload: [],
    failed: [],
    bytes: 0,
    rankCopied: 0,
  }

  async function saveOne(item: ListedItem, segments: string[]): Promise<void> {
    const rawName = itemName(item)
    const fileName = safePathSegment(rawName)
    const relative = [...segments, fileName].join("/")
    const destName = rankName(fileName) || fileName
    const dest = path.join(rankRoot, destName)
    try {
      const existing = await stat(dest).catch(() => null)
      if (existing && existing.isFile() && existing.size > 0) {
        result.alreadyThere += 1
        result.bytes += existing.size
        result.rankCopied += 1
        return
      }
      const bytes = await downloadTo(pacer, itemId(item), destName, dest)
      result.saved += 1
      result.bytes += bytes
      result.rankCopied += 1
      if ((result.saved + result.alreadyThere) % 10 === 0) logProgress(result)
    } catch (err) {
      const noUrl = !!err && typeof err === "object" && "noUrl" in err && (err as { noUrl?: boolean }).noUrl
      if (noUrl) {
        result.noDownload.push(relative)
        return
      }
      if (isImaRateLimit(err) || isImaDailyFetchCap(err)) throw err
      result.failed.push({ path: relative, message: err instanceof Error ? err.message : String(err) })
      console.log(`[ima-mirror] fail ${relative}: ${err instanceof Error ? err.message : err}`)
    }
  }

  async function walk(folderId: string | undefined, segments: string[]): Promise<void> {
    const items = await listFolder(pacer, kbId, folderId)
    for (const item of items) {
      const name = itemName(item)
      if (!name || !itemId(item)) continue
      if (isFolder(item)) {
        if (isSkippedImaFolderName(name)) {
          result.skippedFolders.push([...segments, name].join("/") || name)
          console.log(`[ima-mirror] skip folder ${[...segments, name].join("/")}`)
          continue
        }
        await walk(itemId(item), [...segments, safePathSegment(name)])
        continue
      }
      await saveOne(item, segments)
    }
  }

  const root = await listFolder(pacer, kbId)
  const section = root.find((item) => isFolder(item) && itemName(item).includes(SECTION_HINT))
  if (!section) throw new Error(`「${KB_NAME}」里没有「${SECTION_HINT}」文件夹`)
  const sectionItems = await listFolder(pacer, kbId, itemId(section))
  const weekly = sectionItems.find((item) => isFolder(item) && itemName(item) === WEEKLY_FOLDER)
  if (!weekly) throw new Error(`「${KB_NAME}」里没有「${WEEKLY_FOLDER}」文件夹`)
  console.log(`[ima-mirror] only ${WEEKLY_FOLDER}, skipping 2025`)
  await walk(itemId(weekly), [WEEKLY_FOLDER])
  logProgress(result)
  return result
}
