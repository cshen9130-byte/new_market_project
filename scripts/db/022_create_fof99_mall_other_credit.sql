-- Non-/fund/price 火富牛 mall calls (advancedlist, info, …).
-- Total consumed = FundMultiPrice batches in fof99_nav_fetch_log
--               + SUM(credits) here.
-- Baseline 2026-09-07: 3061 + 122 = 3183 (mall dashboard).
CREATE TABLE IF NOT EXISTS fof99_mall_other_credit (
  id         BIGSERIAL PRIMARY KEY,
  api        TEXT        NOT NULL,
  credits    INTEGER     NOT NULL CHECK (credits > 0),
  note       TEXT,
  batch_id   TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fof99_mall_other_credit_batch
  ON fof99_mall_other_credit (batch_id);

INSERT INTO fof99_mall_other_credit (api, credits, note, batch_id, fetched_at)
SELECT
  '/fund/advancedlist',
  122,
  'Backfill 2026-09-07: mall 总调用 3183 − logged FundMultiPrice 3061. Advancedlist crawl + other non-price mall calls before this table.',
  'backfill-mall-2026-09-07',
  TIMESTAMPTZ '2026-09-04 16:00:00+08'
WHERE NOT EXISTS (
  SELECT 1 FROM fof99_mall_other_credit WHERE batch_id = 'backfill-mall-2026-09-07'
);

CREATE OR REPLACE VIEW fof99_credit_usage AS
SELECT
  price.credits AS fund_multi_price_credits,
  COALESCE(other.credits, 0) AS other_mall_credits,
  price.credits + COALESCE(other.credits, 0) AS total_credits
FROM (
  SELECT COUNT(*)::INTEGER AS credits
  FROM (
    SELECT 1
    FROM fof99_nav_fetch_log
    WHERE batch_id IS NOT NULL
      AND BTRIM(batch_id) <> ''
      AND batch_id NOT LIKE 'batch:%'
    GROUP BY batch_id, DATE_TRUNC('minute', fetched_at)
  ) t
) price
CROSS JOIN (
  SELECT COALESCE(SUM(credits), 0)::INTEGER AS credits
  FROM fof99_mall_other_credit
) other;
