import { Icon, Tooltip } from '@blueprintjs/core';

interface HelpTipProps {
  /** The explanation shown on hover. */
  content: string;
  /**
   * Icon size in pixels.
   * @default 12
   */
  size?: number;
}

/**
 * Inline question-mark icon carrying an explanation. Use it next to any figure
 * whose meaning is not obvious from the number alone — a percentage measured
 * over a reduced range, a derived total, a projection.
 * @param root0 - Component props.
 * @param root0.content - The explanation shown on hover.
 * @param root0.size - Icon size in pixels.
 * @returns The help icon and its tooltip.
 */
export default function HelpTip({ content, size = 12 }: HelpTipProps) {
  return (
    <Tooltip
      compact
      content={
        <span style={{ display: 'block', maxWidth: 260 }}>{content}</span>
      }
      className="help-icon"
    >
      <Icon icon="help" size={size} style={{ cursor: 'help', opacity: 0.7 }} />
    </Tooltip>
  );
}
