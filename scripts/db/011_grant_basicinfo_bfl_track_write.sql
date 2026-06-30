-- Grant market_user write access to basicinfo_bfl_track (run as table owner / postgres).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE basicinfo_bfl_track TO market_user;
GRANT USAGE, SELECT ON SEQUENCE basicinfo_bfl_track_id_seq TO market_user;
