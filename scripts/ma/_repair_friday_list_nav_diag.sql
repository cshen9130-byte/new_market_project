\pset pager off

WITH list_hi AS (
  SELECT n.beian_hao, n.price_date, n.nav::numeric AS nav,
         n.cumulative_nav::numeric AS stored_adj,
         n.cum_nav_withdrawal::numeric AS stored_cum
  FROM private_fund_nav n
  JOIN fof99_nav_fetch_log g
    ON UPPER(BTRIM(g.reg_code)) = UPPER(BTRIM(n.beian_hao))
   AND g.price_date = n.price_date
  WHERE g.batch_id ~ '^fri-pm-[0-9]{4}-[0-9]{2}-[0-9]{2}-p[0-9]+$'
    AND g.status = 'ok'
    AND n.cumulative_nav > n.cum_nav_withdrawal
    AND n.nav IS NOT NULL
),
paired AS (
  SELECT l.*,
         p.nav::numeric AS prev_nav,
         p.cumulative_nav::numeric AS prev_adj,
         p.cum_nav_withdrawal::numeric AS prev_cum,
         g2.batch_id AS prev_batch
  FROM list_hi l
  JOIN LATERAL (
    SELECT p.*
    FROM private_fund_nav p
    WHERE p.beian_hao = l.beian_hao
      AND p.price_date < l.price_date
      AND p.nav IS NOT NULL
    ORDER BY p.price_date DESC
    LIMIT 1
  ) p ON true
  JOIN fof99_nav_fetch_log g2
    ON UPPER(BTRIM(g2.reg_code)) = UPPER(BTRIM(l.beian_hao))
   AND g2.price_date = p.price_date
  WHERE g2.batch_id !~ '^fri-pm-[0-9]{4}-[0-9]{2}-[0-9]{2}-p[0-9]+$'
)
SELECT
  COUNT(*) AS paired,
  COUNT(*) FILTER (
    WHERE prev_nav > 0
      AND abs(stored_adj - (nav + (prev_cum - prev_nav))) <= 0.001
      AND abs(stored_cum - prev_adj * nav / prev_nav) <= 0.001
  ) AS still_swapped_vs_prev_labels,
  COUNT(*) FILTER (
    WHERE prev_nav > 0
      AND abs(stored_cum - (nav + (prev_cum - prev_nav))) <= 0.001
      AND abs(stored_adj - prev_adj * nav / prev_nav) <= 0.001
  ) AS already_correct_vs_prev_labels,
  COUNT(*) FILTER (
    WHERE prev_batch ~ '^fri-pm-[0-9]{4}-[0-9]{2}-[0-9]{2}-p[0-9]+$'
  ) AS prev_also_list
FROM paired;
