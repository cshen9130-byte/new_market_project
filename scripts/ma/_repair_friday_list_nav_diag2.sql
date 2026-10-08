\pset pager off

-- Classify p-batch rows against the nearest earlier row whose fetch log is NOT a list page.
WITH list_rows AS (
  SELECT n.beian_hao, n.price_date, n.nav::numeric AS nav,
         n.cumulative_nav::numeric AS stored_adj,
         n.cum_nav_withdrawal::numeric AS stored_cum,
         CASE
           WHEN n.cum_nav_withdrawal > n.cumulative_nav THEN 'hi_withdraw'
           WHEN n.cumulative_nav > n.cum_nav_withdrawal THEN 'hi_cum'
           ELSE 'tie'
         END AS bucket
  FROM private_fund_nav n
  JOIN fof99_nav_fetch_log g
    ON UPPER(BTRIM(g.reg_code)) = UPPER(BTRIM(n.beian_hao))
   AND g.price_date = n.price_date
  WHERE g.batch_id ~ '^fri-pm-[0-9]{4}-[0-9]{2}-[0-9]{2}-p[0-9]+$'
    AND g.status = 'ok'
    AND n.nav IS NOT NULL
    AND n.cumulative_nav IS NOT NULL
    AND n.cum_nav_withdrawal IS NOT NULL
    AND n.cumulative_nav <> n.cum_nav_withdrawal
),
paired AS (
  SELECT l.*,
         a.nav::numeric AS prev_nav,
         a.cumulative_nav::numeric AS prev_adj,
         a.cum_nav_withdrawal::numeric AS prev_cum,
         a.price_date AS anchor_date
  FROM list_rows l
  JOIN LATERAL (
    SELECT p.nav, p.cumulative_nav, p.cum_nav_withdrawal, p.price_date
    FROM private_fund_nav p
    JOIN fof99_nav_fetch_log g2
      ON UPPER(BTRIM(g2.reg_code)) = UPPER(BTRIM(p.beian_hao))
     AND g2.price_date = p.price_date
    WHERE p.beian_hao = l.beian_hao
      AND p.price_date < l.price_date
      AND p.nav IS NOT NULL
      AND p.cumulative_nav IS NOT NULL
      AND p.cum_nav_withdrawal IS NOT NULL
      AND g2.batch_id !~ '^fri-pm-[0-9]{4}-[0-9]{2}-[0-9]{2}-p[0-9]+$'
    ORDER BY p.price_date DESC
    LIMIT 1
  ) a ON true
)
SELECT bucket,
  COUNT(*) AS paired,
  COUNT(*) FILTER (
    WHERE prev_nav > 0
      AND abs(stored_adj - (nav + (prev_cum - prev_nav))) <= 0.002
      AND abs(stored_cum - prev_adj * nav / NULLIF(prev_nav, 0)) <= 0.002
  ) AS still_swapped,
  COUNT(*) FILTER (
    WHERE prev_nav > 0
      AND abs(stored_cum - (nav + (prev_cum - prev_nav))) <= 0.002
      AND abs(stored_adj - prev_adj * nav / NULLIF(prev_nav, 0)) <= 0.002
  ) AS already_correct
FROM paired
GROUP BY bucket
ORDER BY bucket;
