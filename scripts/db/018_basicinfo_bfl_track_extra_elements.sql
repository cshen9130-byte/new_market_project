-- Extra 申赎要素 fields used by 运维编辑要素 → 基金档案.
ALTER TABLE basicinfo_bfl_track
  ADD COLUMN IF NOT EXISTS risk_level text,
  ADD COLUMN IF NOT EXISTS lock_period_desc text,
  ADD COLUMN IF NOT EXISTS fee_pay_formula text,
  ADD COLUMN IF NOT EXISTS fee_pay_formula_json jsonb;
