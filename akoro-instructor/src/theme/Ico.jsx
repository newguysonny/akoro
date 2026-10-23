/**
 * Ico — the learner app's Tabler glyph:  <Ico ti="ti-x" size={18} color={C.muted}/>
 * `lucide` is only a fallback for a use that has no Tabler name yet.
 */
import { Icon } from '../ui/Icon.jsx';

export function Ico({ lucide: Lucide, ti, size = 16, color, style, className, ...rest }) {
  if (ti) return <Icon name={ti} size={size} color={color} style={style} className={className}/>;
  return Lucide ? <Lucide size={size} color={color} style={style} className={className} {...rest}/> : null;
}
