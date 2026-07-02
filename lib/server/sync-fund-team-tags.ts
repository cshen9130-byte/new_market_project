import { query } from "@/lib/db"

/** Mirror ops_fund_tags into type6_ops_team_full.tag.company and list caches. */
export async function syncFundTeamTagsToSource(beian_hao: string): Promise<void> {
  const rows = await query<{ tag_name: string }>(
    `SELECT tag_name FROM ops_fund_tags WHERE beian_hao = $1 ORDER BY created_at ASC`,
    [beian_hao],
  )
  const tagsJson = JSON.stringify(rows.map((r) => r.tag_name))

  await query(
    `UPDATE type6_ops_team_full
     SET tag = jsonb_set(COALESCE(tag, '{}'::jsonb), '{company}', $2::jsonb)
     WHERE register_number = $1`,
    [beian_hao, tagsJson],
  ).catch(() => {
    // market_user may lack UPDATE on type6_ops_team_full; ops_fund_tags remains source of truth.
  })

  await query(
    `UPDATE ops_tracking_funds_list_cache
     SET team_tags = $2::jsonb
     WHERE beian_hao = $1`,
    [beian_hao, tagsJson],
  ).catch(() => {})

  await query(
    `UPDATE ops_managed_products_list_cache
     SET team_tags = $2::jsonb
     WHERE beian_hao = $1`,
    [beian_hao, tagsJson],
  ).catch(() => {})
}

/** Propagate a renamed team tag to fund assignments and cached list rows. */
export async function renameTeamTagInSources(oldName: string, newName: string): Promise<void> {
  if (!oldName || !newName || oldName === newName) return

  await query(`UPDATE ops_fund_tags SET tag_name = $2 WHERE tag_name = $1`, [oldName, newName])

  await query(
    `UPDATE type6_ops_team_full
     SET tag = jsonb_set(
       COALESCE(tag, '{}'::jsonb),
       '{company}',
       (
         SELECT COALESCE(jsonb_agg(
           CASE WHEN BTRIM(elem #>> '{}') = $1 THEN to_jsonb($2::text) ELSE elem END
         ), '[]'::jsonb)
         FROM jsonb_array_elements(COALESCE(tag->'company', '[]'::jsonb)) AS elem
       )
     )
     WHERE EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(COALESCE(tag->'company', '[]'::jsonb)) t(v)
       WHERE BTRIM(v) = $1
     )`,
    [oldName, newName],
  )

  await query(
    `UPDATE ops_tracking_funds_list_cache c
     SET team_tags = CASE
       WHEN jsonb_typeof(o.tag->'company') = 'array' THEN o.tag->'company'
       ELSE '[]'::jsonb
     END
     FROM type6_ops_team_full o
     WHERE o.register_number = c.beian_hao
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(COALESCE(c.team_tags, '[]'::jsonb)) t(v)
         WHERE BTRIM(v) = $1 OR BTRIM(v) = $2
       )`,
    [oldName, newName],
  ).catch(() => {})

  await query(
    `UPDATE ops_managed_products_list_cache c
     SET team_tags = CASE
       WHEN jsonb_typeof(o.tag->'company') = 'array' THEN o.tag->'company'
       ELSE '[]'::jsonb
     END
     FROM type6_ops_team_full o
     WHERE o.register_number = c.beian_hao
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(COALESCE(c.team_tags, '[]'::jsonb)) t(v)
         WHERE BTRIM(v) = $1 OR BTRIM(v) = $2
       )`,
    [oldName, newName],
  ).catch(() => {})
}
