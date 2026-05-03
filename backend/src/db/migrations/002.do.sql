CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES
  ('panel_surface_m2',    '46'),
  ('panel_efficiency_pct', '21');
