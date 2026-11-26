import { runImaDianjingRankEtl } from "@/lib/server/ima-dianjing-rank"

runImaDianjingRankEtl()
  .then((result) => {
    console.log(JSON.stringify({
      knowledgeBase: result.knowledgeBase,
      folder: result.folder,
      weekEnd: result.weekEnd,
      saved: result.saved,
      bytes: result.bytes,
    }, null, 2))
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
