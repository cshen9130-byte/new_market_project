\pset pager off
SET statement_timeout = '180s';
SET work_mem = '256MB';

DROP TABLE IF EXISTS _fri_pts;
CREATE TEMP TABLE _fri_pts AS
SELECT n.beian_hao,
       n.price_date,
       n.nav::numeric AS nav,
       n.cumulative_nav::numeric AS adj,
       n.cum_nav_withdrawal::numeric AS cum,
       (g.batch_id ~ '^fri-pm-[0-9]{4}-[0-9]{2}-[0-9]{2}-p[0-9]+$') AS is_list
FROM private_fund_nav n
JOIN fof99_nav_fetch_log g
  ON g.reg_code = n.beian_hao
 AND g.price_date = n.price_date
WHERE g.status = 'ok';

CREATE INDEX _fri_pts_code_date ON _fri_pts (beian_hao, price_date DESC);
ANALYZE _fri_pts;

DROP TABLE IF EXISTS _fri_classified;
CREATE TEMP TABLE _fri_classified AS
SELECT l.beian_hao,
       l.price_date,
       l.nav,
       l.adj,
       l.cum,
       a.price_date AS anchor_date,
       a.nav AS prev_nav,
       a.adj AS prev_adj,
       a.cum AS prev_cum,
       CASE
         WHEN a.price_date IS NULL THEN 'no_anchor'
         WHEN a.nav IS NULL OR a.nav = 0 OR l.nav IS NULL THEN 'no_anchor'
         ELSE 'anchored'
       END AS anchor_state,
       (l.nav + (a.cum - a.nav)) AS expected_cum,
       (a.adj * l.nav / NULLIF(a.nav, 0)) AS expected_adj
FROM _fri_pts l
LEFT JOIN LATERAL (
  SELECT p.price_date, p.nav, p.adj, p.cum
  FROM _fri_pts p
  WHERE p.beian_hao = l.beian_hao
    AND p.price_date < l.price_date
    AND NOT p.is_list
    AND p.nav IS NOT NULL
    AND p.adj IS NOT NULL
    AND p.cum IS NOT NULL
  ORDER BY p.price_date DESC
  LIMIT 1
) a ON true
WHERE l.is_list
  AND l.nav IS NOT NULL
  AND l.adj IS NOT NULL
  AND l.cum IS NOT NULL
  AND l.adj <> l.cum;

ALTER TABLE _fri_classified
  ADD COLUMN err_swapped numeric,
  ADD COLUMN err_correct numeric,
  ADD COLUMN verdict text;

UPDATE _fri_classified
SET err_swapped = abs(adj - expected_cum) + abs(cum - expected_adj),
    err_correct = abs(cum - expected_cum) + abs(adj - expected_adj)
WHERE anchor_state = 'anchored';

UPDATE _fri_classified
SET verdict = CASE
  WHEN anchor_state <> 'anchored' THEN 'no_anchor'
  WHEN err_swapped <= GREATEST(0.0015, 0.0003 * GREATEST(nav, prev_nav))
   AND err_swapped + 0.001 < err_correct THEN 'swap'
  WHEN err_correct <= GREATEST(0.0015, 0.0003 * GREATEST(nav, prev_nav))
   AND err_correct + 0.001 < err_swapped THEN 'keep'
  ELSE 'unclear'
END;

SELECT verdict, COUNT(*)
FROM _fri_classified
GROUP BY verdict
ORDER BY verdict;

SELECT price_date::text, nav::text, adj::text AS stored_cumulative_nav,
       cum::text AS stored_cum_nav_withdrawal, verdict,
       round(err_swapped, 6) AS err_swapped, round(err_correct, 6) AS err_correct,
       anchor_date::text
FROM _fri_classified
WHERE beian_hao = 'SXL292' AND price_date >= DATE '2026-08-21'
ORDER BY price_date;
