import { useTheme } from '../../contexts/ThemeContext.jsx';

/**
 * AkoroLogo — renders the correct mark SVG based on current theme.
 *
 * Props:
 *   size   — pixel size of the mark (default 34)
 *   radius — border-radius (default 10)
 *   style  — extra inline styles on the img wrapper
 *
 * The mark images are the real SVGs from /logo/:
 *   light mode → /logo/akoro-mark-transparent.svg
 *   dark  mode → /logo/akoro-mark-transparent-dark.svg
 * Both are on transparent backgrounds so they sit cleanly inside
 * whatever container you give them.
 */
export default function AkoroLogo({ size = 34, radius = 10, style = {} }) {
  const { isDark } = useTheme();
  const src = isDark
    ? '/logo/akoro-mark-transparent-dark.svg'
    : '/logo/akoro-mark-transparent.svg';
  return (
    <img
      src={src}
      alt="Akoro"
      width={size}
      height={size}
      style={{ borderRadius: radius, display: 'block', flexShrink: 0, ...style }}
    />
  );
}

/**
 * AkoroWordmark — the full horizontal lockup (mark + "akoro" wordmark).
 * Use for nav headers where text fits.
 *
 * Props:
 *   height — height of the lockup image (default 32)
 *   style  — extra inline styles
 */
export function AkoroWordmark({ height = 32, style = {} }) {
  return (
    <img
      src="/logo/akoro-lockup-dark.svg"
      alt="Akoro"
      height={height}
      style={{ display: 'block', flexShrink: 0, ...style }}
    />
  );
}
