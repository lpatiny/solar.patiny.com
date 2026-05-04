-- Tracks which local calendar dates have been fully scraped from SolarWeb.
-- Decouples the "have we fetched date D?" question from UTC timestamp bucketing,
-- so the skip-logic in scrapeAllHistory does not depend on server timezone.
CREATE TABLE solarweb_synced_dates (
  date TEXT PRIMARY KEY  -- local calendar date 'YYYY-MM-DD' (as used by the SolarWeb API)
);

-- Backfill from existing data: any UTC date with at least 12 readings in the
-- 10:00–14:00 UTC window is treated as a fully-synced local calendar day.
-- For UTC+2 (Switzerland), UTC 10:00–14:00 = local 12:00–16:00 on the same date,
-- so the UTC and local dates always agree for this midday window.
INSERT OR IGNORE INTO solarweb_synced_dates (date)
SELECT date(timestamp, 'unixepoch') AS day
FROM solarweb_readings
WHERE (timestamp % 86400) BETWEEN 36000 AND 50400
GROUP BY day
HAVING COUNT(*) >= 12;
