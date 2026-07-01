const AMAC_BASE = "https://gs.amac.org.cn/amac-infodisc/res/pof"

/** AMAC manager registration search (登记编号). */
export function amacManagerUrl(registrationNo: string) {
  return `${AMAC_BASE}/manager/managerList.html?keyword=${encodeURIComponent(registrationNo)}`
}

/** AMAC fund registration search (备案编号 / 基金编号). */
export function amacFundSearchUrl(registerNumber: string) {
  return `${AMAC_BASE}/fund/index.html?keywordCode=${encodeURIComponent(registerNumber)}`
}

/** Open AMAC fund disclosure; resolves to the direct page when available. */
export function amacFundUrl(registerNumber: string) {
  return `/ma/amac/fund/${encodeURIComponent(registerNumber)}`
}
