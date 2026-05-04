interface FormulaBlockProps {
  /** Raw MathML HTML string */
  html: string;
  inline?: boolean;
}

/**
 * Renders a MathML formula using the browser's native MathML renderer.
 * React 19 supports MathML elements natively; this component handles
 * pre-built MathML strings for complex multi-element expressions.
 */
export default function FormulaBlock({
  html,
  inline = false,
}: FormulaBlockProps) {
  return (
    <span
      style={
        inline
          ? undefined
          : { display: 'block', overflowX: 'auto', padding: '8px 0' }
      }
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
