/**
 * Spinner — the inline loading affordance for buttons mid-request.
 * Pure CSS (no network, no icon-font dependency); inherits the button's
 * accent through `color` so it reads on both brand and neutral buttons.
 */
export default function Spinner({ size = 13, color = '#fff', style = {} }) {
  return (
    <span aria-label="Loading" style={{
      width: size, height: size, borderRadius: '50%', display: 'inline-block', flexShrink: 0,
      border: `${Math.max(2, Math.round(size / 7))}px solid ${color}44`,
      borderTopColor: color,
      animation: 'ak-spin .7s linear infinite',
      ...style,
    }}/>
  );
}
