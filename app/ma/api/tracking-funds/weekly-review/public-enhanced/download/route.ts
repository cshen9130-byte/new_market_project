import { readPublicEnhancedWeeklyJobFile } from "@/lib/server/public-enhanced-weekly-review"
import { serveCachedWeeklyReviewExcel } from "@/lib/server/weekly-review-excel-download"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return serveCachedWeeklyReviewExcel("public-enhanced", req, readPublicEnhancedWeeklyJobFile)
}
