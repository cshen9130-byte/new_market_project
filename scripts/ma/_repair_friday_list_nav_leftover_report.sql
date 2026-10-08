-- Swap 累计/复权 on Friday FundAdvancedList rows that are still in the wrong columns.
-- List batches are fri-pm-YYYY-MM-DD-pNNNN. A later FundMultiPrice update can leave
-- the log on that batch while the columns are already right, so this does not swap
-- on column order. It swaps only when the numbers still match the reversed mapping
-- against an earlier non-list row, or when the list run itself chains as reversed.
\set ON_ERROR_STOP on
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
  ADD COLUMN verdict text,
  ADD COLUMN chain_swap boolean NOT NULL DEFAULT false,
  ADD COLUMN chain_keep boolean NOT NULL DEFAULT false,
  ADD COLUMN do_swap boolean NOT NULL DEFAULT false;

UPDATE _fri_classified
SET err_swapped = abs(adj - expected_cum) + abs(cum - expected_adj),
    err_correct = abs(cum - expected_cum) + abs(adj - expected_adj)
WHERE anchor_date IS NOT NULL
  AND prev_nav > 0;

UPDATE _fri_classified
SET verdict = CASE
  WHEN anchor_date IS NULL OR prev_nav IS NULL OR prev_nav = 0 THEN 'no_anchor'
  WHEN err_swapped <= GREATEST(0.01, 0.001 * GREATEST(nav, prev_nav))
   AND err_swapped * 5 < err_correct THEN 'swap'
  WHEN err_correct <= GREATEST(0.01, 0.001 * GREATEST(nav, prev_nav))
   AND err_correct * 5 < err_swapped THEN 'keep'
  ELSE 'unclear'
END;

DROP TABLE IF EXISTS _fri_steps;
CREATE TEMP TABLE _fri_steps AS
SELECT beian_hao,
       price_date,
       prev_date,
       swap_err,
       keep_err,
       (
         pnav > 0
         AND swap_err <= GREATEST(0.001, 0.0002 * nav)
         AND swap_err * 5 < keep_err
       ) AS swap_step,
       (
         pnav > 0
         AND keep_err <= GREATEST(0.001, 0.0002 * nav)
         AND keep_err * 5 < swap_err
       ) AS keep_step
FROM (
  SELECT beian_hao, price_date, nav, prev_date, pnav,
         abs((adj - nav) - (padj - pnav)) + abs(cum - pcum * nav / pnav) AS swap_err,
         abs((cum - nav) - (pcum - pnav)) + abs(adj - padj * nav / pnav) AS keep_err
  FROM (
    SELECT beian_hao, price_date, nav, adj, cum,
           lag(price_date) OVER w AS prev_date,
           lag(nav) OVER w AS pnav,
           lag(adj) OVER w AS padj,
           lag(cum) OVER w AS pcum
    FROM _fri_pts
    WHERE is_list
      AND nav IS NOT NULL
      AND adj IS NOT NULL
      AND cum IS NOT NULL
    WINDOW w AS (PARTITION BY beian_hao ORDER BY price_date)
  ) s
  WHERE prev_date IS NOT NULL
    AND pnav > 0
) scored;

DROP TABLE IF EXISTS _fri_chain;
CREATE TEMP TABLE _fri_chain AS
SELECT beian_hao,
       price_date,
       bool_or(swap_step) AS any_swap,
       bool_or(keep_step) AS any_keep
FROM (
  SELECT beian_hao, price_date, swap_step, keep_step FROM _fri_steps
  UNION ALL
  SELECT beian_hao, prev_date, swap_step, keep_step FROM _fri_steps
) e
GROUP BY beian_hao, price_date;

UPDATE _fri_classified c
SET chain_swap = COALESCE(k.any_swap, false) AND NOT COALESCE(k.any_keep, false),
    chain_keep = COALESCE(k.any_keep, false) AND NOT COALESCE(k.any_swap, false)
FROM _fri_chain k
WHERE k.beian_hao = c.beian_hao
  AND k.price_date = c.price_date;

-- A difference under 0.00005 is the same number at 4dp. Leave those alone.
-- An earlier non-list row outranks the list-to-list chain.
UPDATE _fri_classified
SET do_swap = abs(adj - cum) > 0.00005
  AND verdict <> 'keep'
  AND (
    verdict = 'swap'
    OR (verdict IN ('unclear', 'no_anchor') AND chain_swap AND NOT chain_keep)
  );

SELECT verdict,
       COUNT(*) AS rows,
       COUNT(*) FILTER (WHERE do_swap) AS swapping
FROM _fri_classified
GROUP BY verdict
ORDER BY verdict;

SELECT
  COUNT(*) FILTER (WHERE do_swap) AS rows_to_swap,
  COUNT(DISTINCT beian_hao) FILTER (WHERE do_swap) AS funds_to_swap,
  COUNT(*) FILTER (WHERE NOT do_swap) AS rows_left
FROM _fri_classified;

\echo ===== STILL NOT SWAPPED =====
SELECT verdict,
       chain_swap,
       chain_keep,
       COUNT(*) AS n
FROM _fri_classified
WHERE NOT do_swap
GROUP BY verdict, chain_swap, chain_keep
ORDER BY verdict, chain_swap, chain_keep;

SELECT beian_hao, price_date::text, nav, adj, cum, verdict,
       chain_swap, chain_keep,
       round(err_swapped, 5) AS err_swapped,
       round(err_correct, 5) AS err_correct
FROM _fri_classified
WHERE NOT do_swap
  AND verdict <> 'keep'
ORDER BY beian_hao, price_date;
