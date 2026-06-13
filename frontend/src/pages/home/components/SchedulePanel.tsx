import {
  Button,
  ButtonGroup,
  Callout,
  NumericInput,
  Tag,
} from '@blueprintjs/core';
import { useState } from 'react';

import type { PostResult, ScheduleSlotInput, Weekday } from './controlApi.ts';
import {
  MAX_CHARGE_POWER_W,
  MAX_DISCHARGE_POWER_W,
  MAX_SCHEDULE_SLOTS,
  WEEKDAYS,
  postSchedule,
} from './controlApi.ts';

interface SchedulePanelProps {
  deviceId: number;
}

const newSlot = (): ScheduleSlotInput => ({
  startTime: '02:00',
  endTime: '06:00',
  days: [...WEEKDAYS],
  action: 'charge',
  powerW: 500,
});

function SlotRow({
  slot,
  onChange,
  onRemove,
}: {
  slot: ScheduleSlotInput;
  onChange: (next: ScheduleSlotInput) => void;
  onRemove: () => void;
}) {
  const max =
    slot.action === 'discharge' ? MAX_DISCHARGE_POWER_W : MAX_CHARGE_POWER_W;
  const toggleDay = (day: Weekday) => {
    const has = slot.days.includes(day);
    onChange({
      ...slot,
      days: has ? slot.days.filter((d) => d !== day) : [...slot.days, day],
    });
  };

  return (
    <div style={{ borderBottom: '1px solid var(--border)', padding: '10px 0' }}>
      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <input
          type="time"
          value={slot.startTime}
          onChange={(event) =>
            onChange({ ...slot, startTime: event.target.value })
          }
        />
        <span style={{ color: 'var(--text-secondary)' }}>→</span>
        <input
          type="time"
          value={slot.endTime}
          onChange={(event) =>
            onChange({ ...slot, endTime: event.target.value })
          }
        />
        <ButtonGroup>
          <Button
            intent={slot.action === 'charge' ? 'success' : 'none'}
            active={slot.action === 'charge'}
            onClick={() => onChange({ ...slot, action: 'charge' })}
          >
            Charge
          </Button>
          <Button
            intent={slot.action === 'discharge' ? 'primary' : 'none'}
            active={slot.action === 'discharge'}
            onClick={() => onChange({ ...slot, action: 'discharge' })}
          >
            Discharge
          </Button>
        </ButtonGroup>
        <NumericInput
          min={0}
          max={max}
          stepSize={10}
          clampValueOnBlur
          style={{ width: 90 }}
          value={slot.powerW}
          rightElement={<span style={{ padding: '0 6px' }}>W</span>}
          onValueChange={(value) =>
            onChange({
              ...slot,
              powerW: Math.max(0, Math.min(max, value || 0)),
            })
          }
        />
        <Button minimal icon="trash" intent="danger" onClick={onRemove} />
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        {WEEKDAYS.map((day) => (
          <Tag
            key={day}
            interactive
            minimal={!slot.days.includes(day)}
            intent="primary"
            onClick={() => toggleDay(day)}
          >
            {day}
          </Tag>
        ))}
      </div>
    </div>
  );
}

/**
 * Editor for the device's per-day/hour Manual-mode schedule. Slots are pushed
 * to the firmware on Apply; the device cannot report its current schedule, so
 * this panel is write-only and starts from a blank slot.
 * @param root0 - Component props.
 * @param root0.deviceId - The device to program.
 * @returns The schedule editor.
 */
export default function SchedulePanel({ deviceId }: SchedulePanelProps) {
  const [slots, setSlots] = useState<ScheduleSlotInput[]>([newSlot()]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PostResult | null>(null);

  const update = (index: number, next: ScheduleSlotInput) => {
    setSlots(slots.map((slot, i) => (i === index ? next : slot)));
  };
  const remove = (index: number) => {
    setSlots(slots.filter((_, i) => i !== index));
  };

  function apply() {
    setBusy(true);
    setResult(null);
    void postSchedule(deviceId, slots)
      .then(setResult)
      .finally(() => setBusy(false));
  }

  return (
    <div style={{ padding: '8px 0' }}>
      {slots.map((slot, index) => (
        <SlotRow
          // eslint-disable-next-line react/no-array-index-key -- slots have no stable id and are reorderable only by add/remove
          key={index}
          slot={slot}
          onChange={(next) => update(index, next)}
          onRemove={() => remove(index)}
        />
      ))}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Button
          icon="add"
          disabled={slots.length >= MAX_SCHEDULE_SLOTS}
          onClick={() => setSlots([...slots, newSlot()])}
        >
          Add slot
        </Button>
        <Button
          intent="primary"
          loading={busy}
          disabled={slots.length === 0}
          onClick={apply}
        >
          Apply schedule
        </Button>
      </div>

      {result && (
        <Callout
          intent={result.ok ? 'success' : 'danger'}
          style={{ marginTop: 10 }}
        >
          {result.text}
        </Callout>
      )}
    </div>
  );
}
