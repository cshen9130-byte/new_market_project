-- Add 运作日 (strategy change date) to team fund elements.
ALTER TABLE basicinfo_bfl_track
  ADD COLUMN IF NOT EXISTS operation_date date;
