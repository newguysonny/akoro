export default function AkoroLogo({ size = 34, radius = 10, style = {} }) {
  return (
    <img
      src="/logo/akoro-mark-transparent.svg"
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
