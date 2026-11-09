import { Icon } from './Icon';

/** Compact, consistent instruction panel for feature-specific guidance. */
export function InfoPanel({ children, className = '', tone = 'info', icon = 'info' }) {
  return (
    <aside className={`info-panel info-panel-${tone} ${className}`.trim()} role="note" data-tone={tone}>
      <span className="info-panel-icon" aria-hidden="true"><Icon name={icon} size={16} /></span>
      <div className="info-panel-copy">{children}</div>
    </aside>
  );
}
