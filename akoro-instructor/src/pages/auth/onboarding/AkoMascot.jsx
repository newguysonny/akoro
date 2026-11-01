/** Ako, the onboarding guide: a small purple ghost with a star. Drawn inline, no image request. */
export default function AkoMascot({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false"
      style={{ flex: '0 0 auto', filter: 'drop-shadow(0 3px 6px rgba(108,59,255,.30))' }}>
      <defs>
        <linearGradient id="ako-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8B5FFF"/><stop offset="1" stopColor="#5B2BE0"/></linearGradient>
      </defs>
      <path d="M32 5 L35.2 13.4 L44 14.2 L37 19.6 L39.2 28.2 L32 23.4 L24.8 28.2 L27 19.6 L20 14.2 L28.8 13.4 Z" fill="#FFC93C" transform="translate(14,-4) scale(.62)"/>
      <path d="M14 22 C14 13 21 8 32 8 C43 8 50 13 50 22 L50 40 C50 50 43 56 32 56 C21 56 14 50 14 40 Z" fill="url(#ako-g)"/>
      <circle cx="25" cy="31" r="3.4" fill="#fff"/><circle cx="39" cy="31" r="3.4" fill="#fff"/>
      <circle cx="25.8" cy="31.6" r="1.8" fill="#221C3F"/><circle cx="39.8" cy="31.6" r="1.8" fill="#221C3F"/>
      <path d="M26.5 40 Q32 45 37.5 40" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round"/>
      <circle cx="19.5" cy="38" r="2.6" fill="#FF9D8A" opacity=".75"/><circle cx="44.5" cy="38" r="2.6" fill="#FF9D8A" opacity=".75"/>
      <path d="M14 44 L8 52 L17 51" fill="url(#ako-g)"/>
    </svg>
  );
}
