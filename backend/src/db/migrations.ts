export const migrations: Array<{ id: number; sql: string }> = [
  {
    id: 1,
    sql: `
      CREATE TABLE readings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        production_w REAL NOT NULL,
        grid_w REAL NOT NULL,
        battery_w REAL NOT NULL,
        consumption_w REAL NOT NULL,
        battery_soc REAL NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_readings_timestamp ON readings(timestamp);

      CREATE TABLE daily_stats (
        date TEXT PRIMARY KEY,
        production_kwh REAL NOT NULL DEFAULT 0,
        export_kwh REAL NOT NULL DEFAULT 0,
        import_kwh REAL NOT NULL DEFAULT 0,
        self_consumption_kwh REAL NOT NULL DEFAULT 0
      );
    `,
  },
  {
    id: 2,
    sql: `
      ALTER TABLE readings ADD COLUMN ac_power_w REAL DEFAULT NULL;
      ALTER TABLE readings ADD COLUMN voltage_a_v REAL DEFAULT NULL;
      ALTER TABLE readings ADD COLUMN voltage_b_v REAL DEFAULT NULL;
      ALTER TABLE readings ADD COLUMN voltage_c_v REAL DEFAULT NULL;
      ALTER TABLE readings ADD COLUMN frequency_hz REAL DEFAULT NULL;
      ALTER TABLE readings ADD COLUMN pv1_power_w REAL DEFAULT NULL;
      ALTER TABLE readings ADD COLUMN pv2_power_w REAL DEFAULT NULL;
      ALTER TABLE readings ADD COLUMN battery_charging_w REAL DEFAULT NULL;
      ALTER TABLE readings ADD COLUMN battery_discharging_w REAL DEFAULT NULL;
      ALTER TABLE readings ADD COLUMN meter_power_w REAL DEFAULT NULL;
    `,
  },
];
