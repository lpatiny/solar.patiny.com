import type { NumericInputProps } from '@blueprintjs/core';
import { Button, Icon, Intent, NumericInput, Tooltip } from '@blueprintjs/core';

import { unitStyle } from './configStyles.ts';

/**
 * A label with an optional question-mark help tooltip. The icon is positioned
 * with the `.help-label`/`.help-icon` pattern (see index.css) so it stays
 * vertically centered with the text.
 * @param root0 - Component props.
 * @param root0.text - The label text.
 * @param root0.help - Optional tooltip explaining the field; omitted hides the icon.
 * @param root0.style - Extra inline styles merged onto the label span.
 * @returns The label, with a help icon when `help` is set.
 */
export function HelpLabel({
  text,
  help,
  style,
}: {
  text: string;
  help?: string;
  style?: React.CSSProperties;
}) {
  if (!help) {
    return <span style={style}>{text}</span>;
  }
  return (
    <span className="help-label" style={style}>
      {text}
      <Tooltip
        compact
        content={
          <span style={{ maxWidth: 260, display: 'block' }}>{help}</span>
        }
        className="help-icon"
      >
        <Icon icon="help" size={12} style={{ cursor: 'help', opacity: 0.7 }} />
      </Tooltip>
    </span>
  );
}

export function Row({
  label,
  help,
  value,
  children,
}: {
  label: string;
  help?: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        alignItems: 'center',
        display: 'flex',
        gap: 8,
        justifyContent: 'space-between',
        padding: '5px 0',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <HelpLabel
        text={label}
        help={help}
        style={{ color: 'var(--text-secondary)', fontSize: 12 }}
      />
      <span style={{ fontSize: 12 }}>
        {value}
        {children}
      </span>
    </div>
  );
}

export function SectionTitle({
  title,
  help,
}: {
  title: string;
  help?: string;
}) {
  return (
    <HelpLabel
      text={title}
      help={help}
      style={{
        color: 'var(--text-secondary)',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        marginBottom: 6,
        marginTop: 16,
        display: help ? 'inline-flex' : 'block',
      }}
    />
  );
}

/**
 * Inline error message in the shared danger color.
 * @param root0 - Component props.
 * @param root0.children - The error text to display.
 * @returns A small red error span.
 */
export function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 11, color: 'var(--danger)' }}>{children}</span>
  );
}

/**
 * A `NumericInput` with a muted unit suffix, fixed width and integer-only entry
 * (`minorStepSize` defaults to `null`). All Blueprint `NumericInput` props pass
 * through, so `min`/`max`/`stepSize`/`value`/`onValueChange` work as usual.
 * @param root0 - Component props (Blueprint `NumericInputProps` plus the two below).
 * @param root0.unit - The unit label rendered as the right element (e.g. `W`, `%`).
 * @param root0.width - Input width in pixels. Defaults to `80`.
 * @returns The unit-suffixed numeric input.
 */
export function UnitNumericInput({
  unit,
  width = 80,
  ...props
}: NumericInputProps & { unit: string; width?: number }) {
  return (
    <NumericInput
      minorStepSize={null}
      {...props}
      style={{ width }}
      rightElement={<span style={unitStyle}>{unit}</span>}
    />
  );
}

/**
 * A save button that reflects whether there are unsaved changes, with an
 * optional inline error, laid out in the standard action row at the bottom of
 * the config sections. With pending changes it is a primary (blue) button
 * showing the action label; once everything is saved it turns into a muted,
 * disabled "Saved ✓" so it is obvious nothing needs saving.
 * @param root0 - Component props.
 * @param root0.label - The button label shown when there are pending changes.
 * @param root0.saving - Whether a save is in flight (shows the loading spinner).
 * @param root0.dirty - Whether there are unsaved changes. Defaults to `true`.
 * @param root0.error - The last error message, or null/undefined when there is none.
 * @param root0.onSave - Called when the button is clicked.
 * @returns The save-action row.
 */
export function SaveRow({
  label,
  saving,
  dirty = true,
  error,
  onSave,
}: {
  label: string;
  saving: boolean;
  dirty?: boolean;
  error?: string | null;
  onSave: () => void;
}) {
  return (
    <div
      style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}
    >
      <Button
        intent={dirty ? Intent.PRIMARY : Intent.NONE}
        disabled={!dirty && !saving}
        loading={saving}
        icon={dirty ? undefined : 'tick'}
        size="small"
        onClick={onSave}
      >
        {dirty ? label : 'Saved'}
      </Button>
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
}
