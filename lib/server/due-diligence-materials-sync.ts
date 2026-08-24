import type { DueDiligenceTableRow } from "@/lib/ma/due-diligence-table"
import {
  DD_MATERIALS_AUTO_LINK_ENABLED,
  buildDdMaterialsAutoFillPatch,
  buildDdMaterialsFolderIndex,
} from "@/lib/ma/due-diligence-materials"
import { getServerDueDiligenceTable, saveServerDueDiligenceTable } from "@/lib/server/due-diligence-table"
import { listKnowledgeBaseTree } from "@/lib/server/knowledge-base"

export type DdMaterialsLinkChange = {
  rowId: string
  ddDate: string
  fundCompany: string
  fromPath: string
  toPath: string
  ddMaterials: string
}

export type DdMaterialsLinkSyncResult = {
  ok: boolean
  totalRows: number
  changedRows: number
  linkedRows: number
  clearedRows: number
  kbFolderCount: number
  changes: DdMaterialsLinkChange[]
  saved: boolean
}

export async function syncDueDiligenceMaterialsLinks(opts?: {
  updatedBy?: string
  dryRun?: boolean
}): Promise<DdMaterialsLinkSyncResult> {
  const updatedBy = opts?.updatedBy?.trim() || "dd_materials_link_etl"
  const dryRun = Boolean(opts?.dryRun)

  if (!DD_MATERIALS_AUTO_LINK_ENABLED) {
    return {
      ok: true,
      totalRows: 0,
      changedRows: 0,
      linkedRows: 0,
      clearedRows: 0,
      kbFolderCount: 0,
      changes: [],
      saved: false,
    }
  }

  const snapshot = await getServerDueDiligenceTable()
  const tree = await listKnowledgeBaseTree(undefined, true)
  const index = buildDdMaterialsFolderIndex(tree)

  const changes: DdMaterialsLinkChange[] = []
  let linkedRows = 0
  let clearedRows = 0

  const nextRows: DueDiligenceTableRow[] = snapshot.rows.map((row) => {
    const patch = buildDdMaterialsAutoFillPatch(row, index)
    if (!patch) return row

    const fromPath = row.ddMaterialsKbPath?.trim() || ""
    const toPath =
      patch.ddMaterialsKbPath === null || patch.ddMaterialsKbPath === undefined
        ? ""
        : String(patch.ddMaterialsKbPath).trim()
    const nextMaterials = patch.ddMaterials ?? row.ddMaterials

    if (toPath && nextMaterials === "已上传") linkedRows += 1
    else if (!toPath && (fromPath || row.ddMaterials.trim() === "已上传")) clearedRows += 1

    changes.push({
      rowId: row.id,
      ddDate: row.ddDate,
      fundCompany: row.fundCompany,
      fromPath,
      toPath,
      ddMaterials: nextMaterials,
    })

    return { ...row, ...patch, updatedAt: new Date().toISOString() }
  })

  const result: DdMaterialsLinkSyncResult = {
    ok: true,
    totalRows: snapshot.rows.length,
    changedRows: changes.length,
    linkedRows,
    clearedRows,
    kbFolderCount: index.folders.size,
    changes,
    saved: false,
  }

  if (changes.length === 0 || dryRun) {
    return result
  }

  await saveServerDueDiligenceTable(nextRows, snapshot.formats, updatedBy)
  result.saved = true
  return result
}
