export const TEAM_TAGS_CHANGED_EVENT = "ops-team-tags-changed"

export type TeamTagsChangedDetail = {
  oldName?: string
  newName?: string
}

export function notifyTeamTagsChanged(detail?: TeamTagsChangedDetail) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(TEAM_TAGS_CHANGED_EVENT, { detail }))
}

export function fetchFundTeamTagOptions(): Promise<string[]> {
  return fetch("/ma/api/ops/team-tags?category=fund")
    .then((r) => r.json())
    .then((d) => (Array.isArray(d) ? d.map((t: { name: string }) => t.name) : []))
    .catch(() => [])
}

export function subscribeTeamTagsChanged(
  handler: (detail?: TeamTagsChangedDetail) => void,
): () => void {
  if (typeof window === "undefined") return () => {}
  const listener = (event: Event) => {
    handler((event as CustomEvent<TeamTagsChangedDetail>).detail)
  }
  window.addEventListener(TEAM_TAGS_CHANGED_EVENT, listener)
  return () => window.removeEventListener(TEAM_TAGS_CHANGED_EVENT, listener)
}
