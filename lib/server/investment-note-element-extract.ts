import {
  FUND_ELEMENT_EXTRACT_MAX_MB,
  isFundElementExtractableFile,
  isFundElementSourceFilename,
} from "@/lib/ma/fund-element-source-file"
import { startContractExtractJob } from "@/lib/server/fund-contract-extract-job"
import {
  createElementExtractJobFromBuffer,
  type ElementExtractJobRow,
} from "@/lib/server/fund-element-extract-jobs"
import { readInvestmentNoteMaterialFile } from "@/lib/server/investment-note-materials"

export type EnqueuedElementExtract = {
  job: ElementExtractJobRow | null
  skipReason: string | null
}

export async function enqueueElementExtractForInvestmentNoteMaterial(input: {
  materialId: string
  fileName: string
  fileSize: number
  uploadedBy: string
}): Promise<EnqueuedElementExtract> {
  if (!isFundElementSourceFilename(input.fileName)) {
    return { job: null, skipReason: null }
  }
  if (!isFundElementExtractableFile({ name: input.fileName, size: input.fileSize })) {
    if (input.fileSize > FUND_ELEMENT_EXTRACT_MAX_MB * 1024 * 1024) {
      return {
        job: null,
        skipReason: `「${input.fileName}」超过 ${FUND_ELEMENT_EXTRACT_MAX_MB}MB，未能自动提取产品要素`,
      }
    }
    return {
      job: null,
      skipReason: `「${input.fileName}」格式暂不支持要素提取（需 PDF / Word / Excel / 图片）`,
    }
  }

  const file = await readInvestmentNoteMaterialFile(input.materialId)
  if (!file?.buffer.length) {
    return { job: null, skipReason: `未能读取「${input.fileName}」，无法提取产品要素` }
  }

  const job = await createElementExtractJobFromBuffer({
    buffer: file.buffer,
    originalFilename: file.filename || input.fileName,
    uploaded_by: input.uploadedBy,
  })
  startContractExtractJob()
  return { job, skipReason: null }
}
