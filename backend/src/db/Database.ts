/* eslint-disable camelcase -- DB fields use snake_case */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { TypedStatementSync } from './TypedStatementSync.ts';
import { migrations } from './migrations.ts';
import type {
  AggregatedReadingRow,
  ComputedDailyStatsRow,
  DailyStatsRow,
  ReadingRow,
} from './rows.ts';

export class Database {
  readonly #slowQueryLog: string;
  readonly #insertReading: TypedStatementSync<ReadingRow>;
  readonly #queryReadingsRaw: TypedStatementSync<ReadingRow>;
  readonly #queryReadingsHourly: TypedStatementSync<AggregatedReadingRow>;
  readonly #queryReadingsDaily: TypedStatementSync<AggregatedReadingRow>;
  readonly #queryDailyStats: TypedStatementSync<DailyStatsRow>;
  readonly #upsertDailyStats: TypedStatementSync<DailyStatsRow>;
  readonly #queryLatestReading: TypedStatementSync<ReadingRow>;
  readonly #computeDailyStats: TypedStatementSync<ComputedDailyStatsRow>;

  public constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.#slowQueryLog = join(dirname(dbPath), '..', 'slow-queries.log');
    const sqlite = new DatabaseSync(dbPath);
    sqlite.exec('PRAGMA journal_mode = WAL');
    sqlite.exec('PRAGMA synchronous = NORMAL');
    this.#runMigrations(sqlite);

    this.#insertReading = this.#prepare<ReadingRow>(
      sqlite,
      `INSERT INTO readings (
         timestamp, production_w, grid_w, battery_w, consumption_w, battery_soc,
         ac_power_w, voltage_a_v, voltage_b_v, voltage_c_v, frequency_hz,
         pv1_power_w, pv2_power_w, battery_charging_w, battery_discharging_w,
         meter_power_w
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    this.#queryReadingsRaw = this.#prepare<ReadingRow>(
      sqlite,
      `SELECT * FROM readings WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp`,
    );

    this.#queryReadingsHourly = this.#prepare<AggregatedReadingRow>(
      sqlite,
      `SELECT
         (timestamp / 3600) * 3600 AS bucket,
         AVG(production_w) AS production_w,
         AVG(grid_w) AS grid_w,
         AVG(battery_w) AS battery_w,
         AVG(consumption_w) AS consumption_w,
         AVG(CASE WHEN battery_soc > 0 AND battery_soc <= 100 THEN battery_soc ELSE NULL END) AS battery_soc,
         AVG(pv1_power_w) AS pv1_power_w,
         AVG(pv2_power_w) AS pv2_power_w
       FROM readings
       WHERE timestamp BETWEEN ? AND ?
       GROUP BY bucket
       ORDER BY bucket`,
    );

    this.#queryReadingsDaily = this.#prepare<AggregatedReadingRow>(
      sqlite,
      `SELECT
         (timestamp / 86400) * 86400 AS bucket,
         AVG(production_w) AS production_w,
         AVG(grid_w) AS grid_w,
         AVG(battery_w) AS battery_w,
         AVG(consumption_w) AS consumption_w,
         AVG(CASE WHEN battery_soc > 0 AND battery_soc <= 100 THEN battery_soc ELSE NULL END) AS battery_soc,
         AVG(pv1_power_w) AS pv1_power_w,
         AVG(pv2_power_w) AS pv2_power_w
       FROM readings
       WHERE timestamp BETWEEN ? AND ?
       GROUP BY bucket
       ORDER BY bucket`,
    );

    this.#queryDailyStats = this.#prepare<DailyStatsRow>(
      sqlite,
      `SELECT * FROM daily_stats WHERE date BETWEEN ? AND ? ORDER BY date`,
    );

    this.#upsertDailyStats = this.#prepare<DailyStatsRow>(
      sqlite,
      `INSERT INTO daily_stats (date, production_kwh, export_kwh, import_kwh, self_consumption_kwh)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET
         production_kwh = excluded.production_kwh,
         export_kwh = excluded.export_kwh,
         import_kwh = excluded.import_kwh,
         self_consumption_kwh = excluded.self_consumption_kwh`,
    );

    this.#queryLatestReading = this.#prepare<ReadingRow>(
      sqlite,
      `SELECT * FROM readings ORDER BY timestamp DESC LIMIT 1`,
    );

    this.#computeDailyStats = this.#prepare<ComputedDailyStatsRow>(
      sqlite,
      `WITH raw AS (
         SELECT
           strftime('%Y-%m-%d', timestamp, 'unixepoch') AS date,
           production_w,
           grid_w,
           LEAD(timestamp) OVER (ORDER BY timestamp) - timestamp AS gap_s
         FROM readings
         WHERE strftime('%Y-%m-%d', timestamp, 'unixepoch') = ?
       ),
       intervals AS (
         SELECT
           date,
           production_w,
           grid_w,
           CASE WHEN gap_s IS NULL OR gap_s > 120 THEN 30 ELSE gap_s END AS interval_s
         FROM raw
       )
       SELECT
         date,
         SUM(production_w * interval_s) / 3600000.0 AS production_kwh,
         SUM(CASE WHEN grid_w < 0 THEN -grid_w * interval_s ELSE 0 END) / 3600000.0 AS export_kwh,
         SUM(CASE WHEN grid_w > 0 THEN grid_w * interval_s ELSE 0 END) / 3600000.0 AS import_kwh
       FROM intervals
       GROUP BY date`,
    );
  }

  #prepare<T>(sqlite: DatabaseSync, sql: string): TypedStatementSync<T> {
    const trimmed = sql.trim();
    return new TypedStatementSync<T>(sqlite.prepare(trimmed), (ms) => {
      const line = `${new Date().toISOString()} [${ms.toFixed(1)}ms] ${trimmed.slice(0, 120)}\n`;
      appendFileSync(this.#slowQueryLog, line);
    });
  }

  #runMigrations(sqlite: DatabaseSync): void {
    sqlite.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY)`,
    );
    const applied = new Set(
      (
        sqlite.prepare(`SELECT id FROM schema_migrations`).all() as Array<{
          id: number;
        }>
      ).map((r) => r.id),
    );
    const insertMigration = sqlite.prepare(
      `INSERT INTO schema_migrations (id) VALUES (?)`,
    );
    for (const migration of migrations) {
      if (!applied.has(migration.id)) {
        sqlite.exec(migration.sql);
        insertMigration.run(migration.id);
      }
    }
  }

  public insertReading(
    timestamp: number,
    production_w: number,
    grid_w: number,
    battery_w: number,
    consumption_w: number,
    battery_soc: number,
    ac_power_w: number | null,
    voltage_a_v: number | null,
    voltage_b_v: number | null,
    voltage_c_v: number | null,
    frequency_hz: number | null,
    pv1_power_w: number | null,
    pv2_power_w: number | null,
    battery_charging_w: number | null,
    battery_discharging_w: number | null,
    meter_power_w: number | null,
  ): void {
    this.#insertReading.run(
      timestamp,
      production_w,
      grid_w,
      battery_w,
      consumption_w,
      battery_soc,
      ac_power_w,
      voltage_a_v,
      voltage_b_v,
      voltage_c_v,
      frequency_hz,
      pv1_power_w,
      pv2_power_w,
      battery_charging_w,
      battery_discharging_w,
      meter_power_w,
    );
  }

  public queryReadingsRaw(from: number, to: number): ReadingRow[] {
    return this.#queryReadingsRaw.all(from, to);
  }

  public queryReadingsHourly(from: number, to: number): AggregatedReadingRow[] {
    return this.#queryReadingsHourly.all(from, to);
  }

  public queryReadingsDaily(from: number, to: number): AggregatedReadingRow[] {
    return this.#queryReadingsDaily.all(from, to);
  }

  public queryDailyStats(from: string, to: string): DailyStatsRow[] {
    return this.#queryDailyStats.all(from, to);
  }

  public upsertDailyStats(
    date: string,
    production_kwh: number,
    export_kwh: number,
    import_kwh: number,
    self_consumption_kwh: number,
  ): void {
    this.#upsertDailyStats.run(
      date,
      production_kwh,
      export_kwh,
      import_kwh,
      self_consumption_kwh,
    );
  }

  public queryLatestReading(): ReadingRow | undefined {
    return this.#queryLatestReading.get();
  }

  public computeDailyStats(date: string): ComputedDailyStatsRow | undefined {
    return this.#computeDailyStats.get(date);
  }
}

export const db = new Database(
  join(import.meta.dirname, '../../../data/sqlite3/solar.db'),
);
