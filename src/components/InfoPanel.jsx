/** Compact, consistent instruction panel for feature-specific guidance. */
export function InfoPanel({ children, className = '', tone = 'info' }) {
  return (
    <aside className={`info-panel info-panel-${tone} ${className}`.trim()} role="note" data-tone={tone}>
      <div className="info-panel-copy">{children}</div>
    </aside>
  );
}
