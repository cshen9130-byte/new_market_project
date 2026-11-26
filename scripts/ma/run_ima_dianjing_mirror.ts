import { mirrorImaDianjingLibrary } from "@/lib/server/ima-dianjing-mirror"

mirrorImaDianjingLibrary()
  .then((result) => {
    console.log(JSON.stringify({
      saved: result.saved,
      alreadyThere: result.alreadyThere,
      rankCopied: result.rankCopied,
      bytes: result.bytes,
      skippedFolders: result.skippedFolders,
      noDownload: result.noDownload.length,
      failed: result.failed,
    }, null, 2))
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
