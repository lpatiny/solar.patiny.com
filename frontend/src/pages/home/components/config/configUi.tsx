import { Icon, Tooltip } from '@blueprintjs/core';

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
