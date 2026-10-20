/**
 * Ico — today's lucide icon on the legacy look, the learner app's Tabler
 * glyph on next:  <Ico lucide={X} ti="ti-x" size={18} color={C.muted}/>
 */
import { Icon } from '../ui/Icon.jsx';
import { isNextUi } from './uiMode.js';

export function Ico({ lucide: Lucide, ti, size = 16, color, style, className, ...rest }) {
  // className (e.g. "spinner") applies on both looks.
  if (isNextUi() && ti) return <Icon name={ti} size={size} color={color} style={style} className={className}/>;
  return Lucide ? <Lucide size={size} color={color} style={style} className={className} {...rest}/> : null;
}
