/**
 * Icon — a glyph from the @tabler/icons-webfont set (the app loads its CSS
 * once, in main.jsx). The learner app's Icon, unchanged:
 *
 *   <Icon name="ti-swords" size={14} color="var(--ak-brand)" />
 */
export function Icon({ name, size = 16, color, style = {}, className = '' }) {
  if (!name) return null;
  return <i className={`ti ${name}${className ? ` ${className}` : ''}`} aria-hidden="true"
    style={{ fontSize: size, color: color || 'inherit', lineHeight: 1, display: 'inline-flex', flexShrink: 0, ...style }}/>;
}
