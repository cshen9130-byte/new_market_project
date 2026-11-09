/** Cluster 3 on the macro-market economic quadrant is 复苏期. */
export const MACRO_RECOVERY_CLUSTER = 3

export const MACRO_RECOVERY_HREF = "/ma/dashboard/macro-market#pca-section"

/**
 * Latest daily PCA/GMM day. A message only when that day sits in 复苏期.
 * The same date is one bell; staying in the regime on later days is a new date.
 */
export function macroRecoveryMessage(input: {
  date: string
  cluster: number | null
}): { title: string; body: string; href: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return null
  if (input.cluster !== MACRO_RECOVERY_CLUSTER) return null
  return {
    title: `${input.date} 宏观市场处于复苏期`,
    body: `最新一日的经济象限是簇 ${MACRO_RECOVERY_CLUSTER}（复苏期）：增长上升、避险下降。`,
    href: MACRO_RECOVERY_HREF,
  }
}
