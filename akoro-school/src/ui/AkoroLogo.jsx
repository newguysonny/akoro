// GENERATED from design-system/ui/AkoroLogo.jsx — edit it there, then run: node design-system/sync.mjs
/**
 * AkoroLogo — the Akoro mark for the current theme (the learner app's, on
 * the kit's theme): /logo/akoro-mark-transparent(-dark).svg from the app's
 * public folder.
 */
import { useTheme } from './theme.jsx';

export default function AkoroLogo({ size = 34, radius = 10, style = {} }) {
  const { isDark } = useTheme();
  return (
    <img src={isDark ? '/logo/akoro-mark-transparent-dark.svg' : '/logo/akoro-mark-transparent.svg'} alt="Akoro"
      width={size} height={size} style={{ borderRadius: radius, display: 'block', flexShrink: 0, ...style }}/>
  );
}
