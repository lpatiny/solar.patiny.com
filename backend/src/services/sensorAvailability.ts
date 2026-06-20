interface SensorRef {
  id: string;
  name: string;
}

/**
 * Determine which known sensors are currently unavailable: those present in the
 * persisted catalog (i.e. seen before, so they have history) but absent from the
 * latest live poll because they are offline or out of Thread range. Surfacing
 * them lets the UI show an explicit "not available" tile instead of silently
 * dropping the sensor.
 * @param known - every sensor ever recorded, from history
 * @param live - sensors reported by the latest successful poll
 * @returns the known sensors with no live reading, in the order of `known`
 */
export function computeUnavailableSensors<Sensor extends SensorRef>(
  known: Sensor[],
  live: ReadonlyArray<{ id: string }>,
): Sensor[] {
  const liveIds = new Set<string>();
  for (const sensor of live) liveIds.add(sensor.id);
  return known.filter((sensor) => !liveIds.has(sensor.id));
}
