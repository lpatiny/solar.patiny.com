/* eslint-disable camelcase, @typescript-eslint/naming-convention -- DB fields use snake_case */
import { db } from '../db/Database.ts';

export function syncDayFromReadings(date: string): void {
  const row = db.computeDailyStats(date);
  if (!row) return;

  const self_consumption_kwh = Math.max(0, row.production_kwh - row.export_kwh);
  db.upsertDailyStats(
    row.date,
    row.production_kwh,
    row.export_kwh,
    row.import_kwh,
    self_consumption_kwh,
  );
}

export function syncRecentDaysFromReadings(): void {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86_400_000)
    .toISOString()
    .slice(0, 10);
  syncDayFromReadings(yesterday);
  syncDayFromReadings(today);
}
