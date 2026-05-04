/* eslint-disable camelcase -- DB fields use snake_case */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import Postgrator from 'postgrator';

import type { MeteoReading } from '../services/meteoStationService.ts';

import { TypedStatementSync } from './TypedStatementSync.ts';
import type {
  AggregatedReadingRow,
  AggregatedSolarwebRow,
  AggregatedWeatherRow,
  ReadingRow,
  SolarwebReadingRow,
  WeatherReadingRow,
} from './rows.ts';

export class Database {
  readonly #slowQueryLog: string;
  readonly #sqlite: DatabaseSync;
  readonly #stmtCache = new Map<string, TypedStatementSync<unknown>>();
  readonly #insertReading: TypedStatementSync<ReadingRow>;
  readonly #queryReadingsRaw: TypedStatementSync<ReadingRow>;
  readonly #queryReadingsHourly: TypedStatementSync<AggregatedReadingRow>;
  readonly #queryReadingsDaily: TypedStatementSync<AggregatedReadingRow>;
  readonly #upsertSolarwebReading: TypedStatementSync<SolarwebReadingRow>;
  readonly #querySolarwebHourly: TypedStatementSync<AggregatedSolarwebRow>;
  readonly #querySolarwebDaily: TypedStatementSync<AggregatedSolarwebRow>;
  readonly #querySolarwebMonthly: TypedStatementSync<AggregatedSolarwebRow>;
  readonly #upsertWeatherReading: TypedStatementSync<WeatherReadingRow>;
  readonly #queryWeatherReadings: TypedStatementSync<WeatherReadingRow>;

  private constructor(dbPath: string, sqlite: DatabaseSync) {
    this.#slowQueryLog = join(dirname(dbPath), '..', 'slow-queries.log');
    this.#sqlite = sqlite;

    this.#insertReading = this.#prepare<ReadingRow>(
      `INSERT INTO readings (
         timestamp, production_w, grid_w, battery_w, consumption_w, battery_soc,
         ac_power_w, voltage_a_v, voltage_b_v, voltage_c_v, frequency_hz,
         pv1_power_w, pv2_power_w, battery_charging_w, battery_discharging_w,
         meter_power_w
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    this.#queryReadingsRaw = this.#prepare<ReadingRow>(
      `SELECT * FROM readings WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp`,
    );

    this.#queryReadingsHourly = this.#prepare<AggregatedReadingRow>(
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

    this.#upsertSolarwebReading = this.#prepare<SolarwebReadingRow>(
      `INSERT INTO solarweb_readings
         (timestamp, production_w, export_w, import_w, self_consumption_w, battery_w, battery_soc_pct)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(timestamp) DO UPDATE SET
         production_w    = excluded.production_w,
         export_w        = excluded.export_w,
         import_w        = excluded.import_w,
         self_consumption_w = excluded.self_consumption_w,
         battery_w       = excluded.battery_w,
         battery_soc_pct = COALESCE(excluded.battery_soc_pct, battery_soc_pct)`,
    );

    this.#querySolarwebHourly = this.#prepare<AggregatedSolarwebRow>(
      `SELECT
         (timestamp / 3600) * 3600 AS bucket,
         AVG(production_w) AS production_w,
         AVG(import_w - export_w) AS grid_w,
         AVG(battery_w) AS battery_w,
         AVG(self_consumption_w + import_w) AS consumption_w,
         AVG(CASE WHEN battery_soc_pct > 0 THEN battery_soc_pct ELSE NULL END) AS battery_soc_max,
         NULL AS battery_soc_min
       FROM solarweb_readings
       WHERE timestamp BETWEEN ? AND ?
       GROUP BY (timestamp / 3600)
       ORDER BY bucket`,
    );

    this.#querySolarwebDaily = this.#prepare<AggregatedSolarwebRow>(
      `SELECT
         (timestamp / 86400) * 86400 + 43200 AS bucket,
         AVG(production_w) AS production_w,
         AVG(import_w - export_w) AS grid_w,
         AVG(battery_w) AS battery_w,
         AVG(self_consumption_w + import_w) AS consumption_w,
         MAX(battery_soc_pct) AS battery_soc_max,
         MIN(battery_soc_pct) AS battery_soc_min
       FROM solarweb_readings
       WHERE timestamp BETWEEN ? AND ?
       GROUP BY (timestamp / 86400)
       ORDER BY bucket`,
    );

    this.#querySolarwebMonthly = this.#prepare<AggregatedSolarwebRow>(
      `SELECT
         CAST(strftime('%s', strftime('%Y-%m-15', day_bucket, 'unixepoch')) AS INTEGER) AS bucket,
         AVG(production_w) AS production_w,
         AVG(grid_w) AS grid_w,
         AVG(battery_w) AS battery_w,
         AVG(consumption_w) AS consumption_w,
         AVG(battery_soc_max) AS battery_soc_max,
         AVG(battery_soc_min) AS battery_soc_min
       FROM (
         SELECT
           (timestamp / 86400) * 86400 AS day_bucket,
           AVG(production_w) AS production_w,
           AVG(import_w - export_w) AS grid_w,
           AVG(battery_w) AS battery_w,
           AVG(self_consumption_w + import_w) AS consumption_w,
           MAX(battery_soc_pct) AS battery_soc_max,
           MIN(battery_soc_pct) AS battery_soc_min
         FROM solarweb_readings
         WHERE timestamp BETWEEN ? AND ?
         GROUP BY day_bucket
       )
       GROUP BY strftime('%Y-%m', day_bucket, 'unixepoch')
       ORDER BY bucket`,
    );

    this.#upsertWeatherReading = this.#prepare<WeatherReadingRow>(
      `INSERT INTO weather_readings (timestamp, station, global_radiation_w, temperature_c, humidity_pct, precipitation_mm, sunshine_min)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(timestamp, station) DO UPDATE SET
         global_radiation_w = COALESCE(excluded.global_radiation_w, global_radiation_w),
         temperature_c      = COALESCE(excluded.temperature_c, temperature_c),
         humidity_pct       = COALESCE(excluded.humidity_pct, humidity_pct),
         precipitation_mm   = COALESCE(excluded.precipitation_mm, precipitation_mm),
         sunshine_min       = COALESCE(excluded.sunshine_min, sunshine_min)`,
    );

    this.#queryWeatherReadings = this.#prepare<WeatherReadingRow>(
      `SELECT * FROM weather_readings WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp`,
    );
  }

  static async open(dbPath: string): Promise<Database> {
    mkdirSync(dirname(dbPath), { recursive: true });
    const sqlite = new DatabaseSync(dbPath);
    sqlite.exec('PRAGMA journal_mode = WAL');
    sqlite.exec('PRAGMA synchronous = NORMAL');

    const postgrator = new Postgrator({
      migrationPattern: join(import.meta.dirname, 'migrations/*'),
      driver: 'sqlite3',
      execQuery: async (query) => ({ rows: sqlite.prepare(query).all() }),
      execSqlScript: async (sql) => {
        sqlite.exec(sql);
      },
    });
    await postgrator.migrate();

    return new Database(dbPath, sqlite);
  }

  #prepare<T>(sql: string): TypedStatementSync<T> {
    const trimmed = sql.trim();
    return new TypedStatementSync<T>(this.#sqlite.prepare(trimmed), (ms) => {
      const line = `${new Date().toISOString()} [${ms.toFixed(1)}ms] ${trimmed.slice(0, 120)}\n`;
      appendFileSync(this.#slowQueryLog, line);
    });
  }

  public statement<T>(sql: string): TypedStatementSync<T> {
    let stmt = this.#stmtCache.get(sql) as TypedStatementSync<T> | undefined;
    if (!stmt) {
      stmt = this.#prepare<T>(sql);
      this.#stmtCache.set(sql, stmt as TypedStatementSync<unknown>);
    }
    return stmt;
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

  /**
   * Batch-insert/update 5-minute SolarWeb readings inside a single transaction.
   * @param rows
   */
  public upsertSolarwebReadings(rows: SolarwebReadingRow[]): void {
    if (rows.length === 0) return;
    this.#sqlite.exec('BEGIN');
    try {
      for (const row of rows) {
        this.#upsertSolarwebReading.run(
          row.timestamp,
          row.production_w,
          row.export_w,
          row.import_w,
          row.self_consumption_w,
          row.battery_w,
          row.battery_soc_pct,
        );
      }
      this.#sqlite.exec('COMMIT');
    } catch (error) {
      this.#sqlite.exec('ROLLBACK');
      throw error;
    }
  }

  public querySolarwebHourly(
    from: number,
    to: number,
  ): AggregatedSolarwebRow[] {
    return this.#querySolarwebHourly.all(from, to);
  }

  public querySolarwebDaily(from: number, to: number): AggregatedSolarwebRow[] {
    return this.#querySolarwebDaily.all(from, to);
  }

  public querySolarwebMonthly(
    from: number,
    to: number,
  ): AggregatedSolarwebRow[] {
    return this.#querySolarwebMonthly.all(from, to);
  }

  public getSolarwebDayCounts(from: number, to: number): Map<string, number> {
    const rows = this.statement<{ day: string; cnt: number }>(
      `SELECT date(timestamp, 'unixepoch') AS day, COUNT(*) AS cnt
       FROM solarweb_readings WHERE timestamp BETWEEN ? AND ?
       GROUP BY day`,
    ).all(from, to);
    return new Map(rows.map((r) => [r.day, r.cnt]));
  }

  public getSyncedDates(from: string, to: string): Set<string> {
    const rows = this.statement<{ date: string }>(
      `SELECT date FROM solarweb_synced_dates WHERE date BETWEEN ? AND ?`,
    ).all(from, to);
    return new Set(rows.map((r) => r.date));
  }

  public markDateSynced(date: string): void {
    this.statement(
      `INSERT OR IGNORE INTO solarweb_synced_dates (date) VALUES (?)`,
    ).run(date);
  }

  public getOldestTimestamp(): number | null {
    const sw =
      this.statement<{ ts: number | null }>(
        'SELECT MIN(timestamp) AS ts FROM solarweb_readings',
      ).get()?.ts ?? null;
    const local =
      this.statement<{ ts: number | null }>(
        'SELECT MIN(timestamp) AS ts FROM readings',
      ).get()?.ts ?? null;
    if (sw === null) return local;
    if (local === null) return sw;
    return Math.min(sw, local);
  }

  /**
   * Batch-upsert MeteoSwiss weather readings inside a single transaction.
   * @param readings
   */
  public upsertWeatherReadings(readings: MeteoReading[]): void {
    if (readings.length === 0) return;
    this.#sqlite.exec('BEGIN');
    try {
      for (const r of readings) {
        this.#upsertWeatherReading.run(
          r.timestamp,
          r.station,
          r.globalRadiationWm2,
          r.temperatureC,
          r.humidityPct,
          r.precipitationMm,
          r.sunshineMin,
        );
      }
      this.#sqlite.exec('COMMIT');
    } catch (error) {
      this.#sqlite.exec('ROLLBACK');
      throw error;
    }
  }

  public queryWeatherReadings(from: number, to: number): WeatherReadingRow[] {
    return this.#queryWeatherReadings.all(from, to);
  }

  public queryWeatherHourly(from: number, to: number): AggregatedWeatherRow[] {
    return this.statement<AggregatedWeatherRow>(
      `SELECT
         (timestamp / 3600) * 3600 AS timestamp,
         station,
         AVG(global_radiation_w) AS global_radiation_w,
         AVG(temperature_c) AS temperature_c,
         AVG(humidity_pct) AS humidity_pct,
         SUM(precipitation_mm) AS precipitation_mm,
         SUM(sunshine_min) AS sunshine_min
       FROM weather_readings
       WHERE timestamp BETWEEN ? AND ?
       GROUP BY (timestamp / 3600), station
       ORDER BY timestamp`,
    ).all(from, to);
  }

  public queryWeatherDaily(from: number, to: number): AggregatedWeatherRow[] {
    return this.statement<AggregatedWeatherRow>(
      `SELECT
         (timestamp / 86400) * 86400 + 43200 AS timestamp,
         station,
         AVG(global_radiation_w) AS global_radiation_w,
         AVG(temperature_c) AS temperature_c,
         AVG(humidity_pct) AS humidity_pct,
         SUM(precipitation_mm) AS precipitation_mm,
         SUM(sunshine_min) AS sunshine_min
       FROM weather_readings
       WHERE timestamp BETWEEN ? AND ?
       GROUP BY (timestamp / 86400), station
       ORDER BY timestamp`,
    ).all(from, to);
  }

  public getOldestSolarwebTimestamp(): number | null {
    return (
      this.statement<{ ts: number | null }>(
        'SELECT MIN(timestamp) AS ts FROM solarweb_readings',
      ).get()?.ts ?? null
    );
  }

  public getTableStats(): Record<string, number> {
    const tables = [
      'readings',
      'solarweb_readings',
      'solarweb_synced_dates',
      'weather_readings',
      'settings',
    ];
    const result: Record<string, number> = {};
    for (const table of tables) {
      const row = this.statement<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM ${table}`,
      ).get();
      result[table] = row?.cnt ?? 0;
    }
    return result;
  }

  public getSetting(key: string): string | null {
    const row = this.statement<{ value: string }>(
      'SELECT value FROM settings WHERE key = ?',
    ).get(key);
    return row?.value ?? null;
  }

  public upsertSetting(key: string, value: string): void {
    this.statement(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(key, value);
  }
}

export const db = await Database.open(
  join(import.meta.dirname, '../../../data/sqlite3/solar.db'),
);
