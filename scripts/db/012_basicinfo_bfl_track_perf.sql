-- Speed up basicinfo_bfl_track lookups after bulk CSV import.
CREATE INDEX IF NOT EXISTS idx_basicinfo_bfl_track_register_updated
  ON basicinfo_bfl_track (register_number, updated_at DESC NULLS LAST, id DESC);

ANALYZE basicinfo_bfl_track;
