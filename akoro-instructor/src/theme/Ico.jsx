/**
 * Ico — today's lucide icon on the legacy look, the learner app's Tabler
 * glyph on next:  <Ico lucide={X} ti="ti-x" size={18} color={C.muted}/>
 */
import { Icon } from '../ui/Icon.jsx';
import { isNextUi } from './uiMode.js';

export function Ico({ lucide: Lucide, ti, size = 16, color, style, ...rest }) {
  if (isNextUi() && ti) return <Icon name={ti} size={size} color={color} style={style}/>;
  return Lucide ? <Lucide size={size} color={color} style={style} {...rest}/> : null;
}
