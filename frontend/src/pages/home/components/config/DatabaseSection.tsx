import { useEffect, useState } from 'react';

import { Row } from './configUi.tsx';

export default function DatabaseSection() {
  const [dbStats, setDbStats] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    void fetch('/api/db/stats')
      .then((r) => r.json())
      .then((s) => setDbStats(s as Record<string, number>))
      .catch(() => null);
  }, []);

  if (dbStats === null) return <Row label="Loading…" />;

  return (
    <div>
      {Object.entries(dbStats).map(([table, count]) => (
        <Row key={table} label={table} value={count.toLocaleString()} />
      ))}
    </div>
  );
}
