/**
 * AgentAvatar.jsx — the hand-drawn avatar set: the same craft as
 * NavIcons (48×48 grid, ink outlines at 2px, round joins, the app
 * palette), one character per avatar a learner can pick.
 *
 * The stored identity stays exactly where it lives — `agent_emoji` for
 * agents, the profile's `avatarEmoji` for the learner — and the emoji
 * string is used purely as a KEY into this set, so no data or API
 * changes and every existing agent keeps its look. Anything unknown
 * (or missing) draws the bot, the app-wide fallback.
 *
 * Two families, one craft:
 *   • agents — bots, brains, owls, rockets… (AgentAvatar)
 *   • people — the learner's own profile portraits, parametric
 *     skin/hair/accessory so the picker's Nigerian skin tones stay
 *     front and center (ProfileAvatar)
 * DrawnAvatar tries both (settings' shared AvatarCircle).
 *
 * Surfaces render through <AgentAvatar emoji="🦉" size={40}/>: the
 * onboarding + no-agent + settings pickers, the chat bubbles and tabs,
 * the session reader, voice exams, battles, and the course pages.
 * Keys cover every picker list (GUIDE_EMOJIS, NoAgentSheet's EMOJIS,
 * settings' EMOJI_LIST/AVATAR_LIST) plus the AGENT_STYLES guide glyphs.
 */

const INK = "#2B2A4C";
const PAPER = "#FFF8E7";
const PURPLE = "#6D3FD9";
const PURPLE_DARK = "#5B33C4";
const LILAC = "#B9A7F5";
const YELLOW = "#FFC93C";
const SKY = "#4DA3FF";
const MINT = "#38C9A0";
const CORAL = "#FF7A6B";
const PINK = "#FF9EC5";

function Base({ size = 48, children, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <g stroke={INK} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
        {children}
      </g>
    </svg>
  );
}

/* Key normalization — strip VS16 so 🦸‍♂️ and 🦸‍♂ (with/without the
   variation selector) land on the same drawing. */
const norm = (emoji) => (typeof emoji === "string" ? emoji.replace(/\uFE0F/g, "") : emoji);

/* Bot — the classic guide, and the fallback for anything unknown */
export function BotAvatar(props) {
  return (
    <Base {...props}>
      <path d="M24 10 V4" />
      <circle cx="24" cy="4" r="2.4" fill={CORAL} />
      <rect x="6" y="20" width="4.5" height="8" rx="2" fill={PURPLE} />
      <rect x="37.5" y="20" width="4.5" height="8" rx="2" fill={PURPLE} />
      <rect x="10" y="12" width="28" height="25" rx="7.5" fill={SKY} />
      <circle cx="18" cy="22.5" r="3.2" fill={PAPER} />
      <circle cx="30" cy="22.5" r="3.2" fill={PAPER} />
      <path d="M18.5 29.5 Q24 33.5 29.5 29.5" />
      <path d="M15 18 L20 17" strokeWidth="1.5" />
      <path d="M33 18 L28 17" strokeWidth="1.5" />
    </Base>
  );
}

/* Brain — NaNa Esumai, the head guide */
export function BrainAvatar(props) {
  return (
    <Base {...props}>
      <path
        d="M9 27 Q7 18 15 16 Q15 9 23 10 Q26 5 32 8 Q39 9 39 16 Q45 19 42 25 Q45 31 39 33 Q38 40 30 39 Q26 44 20 40 Q11 41 11 34 Q5 31 9 27 Z"
        fill={PINK}
      />
      <path d="M24 10 Q22 16 26 21 Q29 26 25 31" strokeWidth="1.6" />
      <path d="M15 16 Q20 19 18 25" strokeWidth="1.6" />
      <path d="M39 16 Q33 19 34 25" strokeWidth="1.6" />
      <path d="M17 33 Q22 36 27 34" strokeWidth="1.6" />
      <path d="M20 40 Q24 36 30 39" strokeWidth="1.6" />
    </Base>
  );
}

/* Alien — the little invader */
export function AlienAvatar(props) {
  return (
    <Base {...props}>
      <path d="M16 12 L12 6" />
      <path d="M32 12 L36 6" />
      <circle cx="12" cy="5.5" r="2" fill={MINT} />
      <circle cx="36" cy="5.5" r="2" fill={MINT} />
      <path
        d="M12 23 Q12 8 24 8 Q36 8 36 23 L36 30 Q36 37 29 37 L19 37 Q12 37 12 30 Z"
        fill={PURPLE}
      />
      <ellipse cx="18.5" cy="23" rx="4" ry="5.4" fill={PAPER} />
      <ellipse cx="29.5" cy="23" rx="4" ry="5.4" fill={PAPER} />
      <circle cx="18.5" cy="24" r="1.7" fill={INK} />
      <circle cx="29.5" cy="24" r="1.7" fill={INK} />
      <path d="M20 31 Q24 33.8 28 31" />
    </Base>
  );
}

/* Owl — the night scholar */
export function OwlAvatar(props) {
  return (
    <Base {...props}>
      <path d="M11 11 L15 17" />
      <path d="M37 11 L33 17" />
      <path
        d="M24 10 Q37 10 39 22 Q42 37 30 40 L18 40 Q6 37 9 22 Q11 10 24 10 Z"
        fill={YELLOW}
      />
      <circle cx="17.5" cy="23" r="6.6" fill={PAPER} />
      <circle cx="30.5" cy="23" r="6.6" fill={PAPER} />
      <circle cx="17.5" cy="23" r="2.6" fill={INK} />
      <circle cx="30.5" cy="23" r="2.6" fill={INK} />
      <polygon points="24,26.5 27.2,31 20.8,31" fill={CORAL} />
      <path d="M9.5 27 Q6 31 10 35" fill={PURPLE_DARK} />
      <path d="M38.5 27 Q42 31 38 35" fill={PURPLE_DARK} />
      <path d="M20 35.5 L21 38.5 M24 35.5 L24 38.5 M28 35.5 L27 38.5" strokeWidth="1.4" />
    </Base>
  );
}

/* Scholar — the graduate */
export function ScholarAvatar(props) {
  return (
    <Base {...props}>
      <circle cx="24" cy="30" r="10.5" fill={PAPER} />
      <circle cx="20.5" cy="32" r="1.7" fill={INK} />
      <circle cx="27.5" cy="32" r="1.7" fill={INK} />
      <path d="M20.5 35.5 Q24 38 27.5 35.5" />
      <path d="M16 20 Q24 25.5 32 20 L32 24 Q24 29 16 24 Z" fill={PURPLE_DARK} />
      <polygon points="24,7 43,15.5 24,24 5,15.5" fill={PURPLE} />
      <path d="M39.5 17.5 L39.5 27" />
      <circle cx="39.5" cy="29.5" r="2.4" fill={YELLOW} />
    </Base>
  );
}

/* Bolt — Sargeant, fast and sharp */
export function BoltAvatar(props) {
  return (
    <Base {...props}>
      <polygon points="27,4 12,26 21,26 18,44 37,20 27,20" fill={YELLOW} />
      <circle cx="24" cy="23" r="1.5" fill={INK} />
      <circle cx="29" cy="23" r="1.5" fill={INK} />
      <path d="M24.5 26.5 Q26.7 28.3 29 26.8" strokeWidth="1.5" />
      <path d="M5 12 L10 13.5" />
      <path d="M4 21 L9 21.5" />
      <path d="M8 34 L13 32" />
    </Base>
  );
}

/* Star — the shining optimist */
export function StarAvatar(props) {
  return (
    <Base {...props}>
      <polygon
        points="24,7 28.8,17.2 40,18.6 31.8,26.2 34,37.4 24,32 14,37.4 16.2,26.2 8,18.6 19.2,17.2"
        fill={YELLOW}
      />
      <circle cx="20.5" cy="22.5" r="1.6" fill={INK} />
      <circle cx="27.5" cy="22.5" r="1.6" fill={INK} />
      <path d="M20.5 26.5 Q24 29.5 27.5 26.5" />
      <path d="M38 6 L39.5 9.5 L43 11 L39.5 12.5 L38 16 L36.5 12.5 L33 11 L36.5 9.5 Z" fill={PAPER} strokeWidth="1.4" />
      <path d="M8 32 L9 34.5 L11.5 35.5 L9 36.5 L8 39 L7 36.5 L4.5 35.5 L7 34.5 Z" fill={PAPER} strokeWidth="1.4" />
    </Base>
  );
}

/* Oracle — the crystal ball */
export function OracleAvatar(props) {
  return (
    <Base {...props}>
      <circle cx="24" cy="21" r="13" fill={PURPLE} />
      <path d="M14.5 16 Q16 11.5 21 10" stroke={PAPER} strokeWidth="2.2" />
      <path d="M20 22 L21.5 25.5 L25 27 L21.5 28.5 L20 32 L18.5 28.5 L15 27 L18.5 25.5 Z" fill={PAPER} strokeWidth="1.4" />
      <path d="M29 16 L29.9 18.1 L32 19 L29.9 19.9 L29 22 L28.1 19.9 L26 19 L28.1 18.1 Z" fill={PAPER} strokeWidth="1.2" />
      <path d="M20 34 L28 34 L30 38 L18 38 Z" fill={PURPLE_DARK} />
      <rect x="14" y="38" width="20" height="3.6" rx="1.8" fill={PURPLE_DARK} />
    </Base>
  );
}

/* Butterfly — the curious wanderer */
export function ButterflyAvatar(props) {
  return (
    <Base {...props}>
      <path d="M22 25 Q11 8 5.5 15 Q1 22 22 31 Z" fill={SKY} />
      <path d="M22 31 Q8 30 10 37 Q13 43 22 35 Z" fill={MINT} />
      <path d="M26 25 Q37 8 42.5 15 Q47 22 26 31 Z" fill={SKY} />
      <path d="M26 31 Q40 30 38 37 Q35 43 26 35 Z" fill={MINT} />
      <ellipse cx="24" cy="28" rx="2.6" ry="8.5" fill={INK} />
      <circle cx="24" cy="18" r="3" fill={INK} />
      <path d="M22.5 15.5 L19 11" strokeWidth="1.6" />
      <path d="M25.5 15.5 L29 11" strokeWidth="1.6" />
      <circle cx="18.5" cy="10" r="1.6" fill={CORAL} strokeWidth="1.2" />
      <circle cx="29.5" cy="10" r="1.6" fill={CORAL} strokeWidth="1.2" />
    </Base>
  );
}

/* Target — the focused one */
export function TargetAvatar(props) {
  return (
    <Base {...props}>
      <circle cx="24" cy="24" r="15" fill={CORAL} />
      <circle cx="24" cy="24" r="10" fill={PAPER} />
      <circle cx="24" cy="24" r="5" fill={CORAL} />
      <circle cx="24" cy="24" r="1.7" fill={INK} />
      <path d="M26 22 L38.5 9.5" strokeWidth="2.4" />
      <path d="M33 6.5 L38.5 9.5 L40 15" strokeWidth="1.8" fill="none" />
    </Base>
  );
}

/* Rocket — the fast starter */
export function RocketAvatar(props) {
  return (
    <Base {...props}>
      <path d="M24 4 Q30.5 11 30.5 23 L30.5 32 Q30.5 36 27.5 38 L20.5 38 Q17.5 36 17.5 32 L17.5 23 Q17.5 11 24 4 Z" fill={PAPER} />
      <path d="M24 4 Q27.5 7.5 29 13 L19 13 Q20.5 7.5 24 4 Z" fill={CORAL} />
      <circle cx="24" cy="20" r="4.4" fill={SKY} />
      <path d="M17.5 27 L9.5 37 L17.5 37 Z" fill={CORAL} />
      <path d="M30.5 27 L38.5 37 L30.5 37 Z" fill={CORAL} />
      <path d="M24 38 Q19.5 41.5 24 46 Q28.5 41.5 24 38 Z" fill={YELLOW} />
    </Base>
  );
}

/* Bulb — the idea machine */
export function BulbAvatar(props) {
  return (
    <Base {...props}>
      <circle cx="24" cy="20" r="11" fill={YELLOW} />
      <path d="M20 29 L20 24 Q24 20 28 24 L28 29" strokeWidth="1.6" />
      <rect x="19.5" y="30" width="9" height="3.2" rx="1.6" fill={PURPLE_DARK} />
      <rect x="20.5" y="34" width="7" height="3.2" rx="1.6" fill={PURPLE_DARK} />
      <path d="M24 3 L24 6.5" strokeWidth="1.8" />
      <path d="M9 8 L11.5 10.5" strokeWidth="1.8" />
      <path d="M39 8 L36.5 10.5" strokeWidth="1.8" />
      <path d="M4.5 20 L8 20" strokeWidth="1.8" />
      <path d="M43.5 20 L40 20" strokeWidth="1.8" />
      <path d="M19 40.5 L29 40.5" />
    </Base>
  );
}

/* Books — the collector */
export function BooksAvatar(props) {
  return (
    <Base {...props}>
      <rect x="7" y="31" width="33" height="7.5" rx="2" fill={CORAL} />
      <path d="M12 31 L12 38.5" strokeWidth="1.4" />
      <rect x="10" y="23" width="31" height="7.5" rx="2" fill={SKY} />
      <path d="M15 23 L15 30.5" strokeWidth="1.4" />
      <rect x="8" y="15" width="32" height="7.5" rx="2" fill={MINT} />
      <path d="M13 15 L13 22.5" strokeWidth="1.4" />
      <path d="M32 15 Q36 12.5 40 14" strokeWidth="1.6" fill="none" />
      <path d="M31 11.5 Q35 9 39 10.5" strokeWidth="1.6" fill="none" />
    </Base>
  );
}

/* Scope — the lab partner */
export function ScopeAvatar(props) {
  return (
    <Base {...props}>
      <path d="M30 5 L21.5 17.5" strokeWidth="4.5" stroke={PURPLE} />
      <circle cx="20" cy="20" r="4" fill={SKY} />
      <path d="M28 30 Q35 26 32.5 15" strokeWidth="2.6" stroke={PURPLE_DARK} fill="none" />
      <path d="M12 30 L30 30" />
      <rect x="17" y="26.5" width="9" height="3" rx="1.2" fill={CORAL} />
      <path d="M15 38 Q13 32 17 30 L25 30 Q29 32 27 38 Z" fill={LILAC} />
      <rect x="11" y="38" width="24" height="3.8" rx="1.9" fill={PURPLE_DARK} />
    </Base>
  );
}

/* Compass — the navigator */
export function CompassAvatar(props) {
  return (
    <Base {...props}>
      <circle cx="24" cy="25" r="15" fill={PAPER} />
      <path d="M24 12 L24 14.8 M24 35.2 L24 38 M11 25 L13.8 25 M34.2 25 L37 25" strokeWidth="1.6" />
      <polygon points="24,14.5 27.4,25 20.6,25" fill={CORAL} />
      <polygon points="24,35.5 27.4,25 20.6,25" fill={LILAC} />
      <circle cx="24" cy="25" r="1.9" fill={INK} />
    </Base>
  );
}

/* Bee — the busy one */
export function BeeAvatar(props) {
  return (
    <Base {...props}>
      <ellipse cx="19" cy="15" rx="6.2" ry="4.2" transform="rotate(-24 19 15)" fill={PAPER} />
      <ellipse cx="29" cy="15" rx="6.2" ry="4.2" transform="rotate(24 29 15)" fill={PAPER} />
      <circle cx="13" cy="27" r="5.6" fill={YELLOW} />
      <ellipse cx="26" cy="28" rx="12" ry="9.5" fill={YELLOW} />
      <path d="M23 19.5 Q21.6 28 23 36.5" strokeWidth="3.4" />
      <path d="M29 19.5 Q27.6 28 29 36.5" strokeWidth="3.4" />
      <circle cx="11" cy="25.5" r="1.2" fill={INK} strokeWidth="0" />
      <path d="M10.5 29 Q12.5 30.8 14.8 29.6" strokeWidth="1.4" />
      <polygon points="38,28 42.5,26.5 42.5,29.5" fill={INK} />
      <path d="M9.5 22.5 L6.5 19" strokeWidth="1.5" />
    </Base>
  );
}

/* Lion — the brave one */
export function LionAvatar(props) {
  return (
    <Base {...props}>
      <circle cx="24" cy="24" r="16.5" fill={YELLOW} />
      <path d="M24 8.5 L26.5 12.5 L30.5 10.5 L31 15 L35.5 14.5 L34 18.5 L38.5 20 L36 23.5 L39.5 26.5 L35.5 28 L37 32 L33 31.5 L32.5 35.5 L29 33.5 L27 37.5 L24 34.5 L21 37.5 L19 33.5 L15.5 35.5 L15 31.5 L11 32 L12.5 28 L8.5 26.5 L12 23.5 L9.5 20 L14 18.5 L12.5 14.5 L17 15 L17.5 10.5 L21.5 12.5 Z" fill={YELLOW} />
      <circle cx="24" cy="24" r="10.5" fill="#F7CE82" />
      <circle cx="9" cy="16" r="2.6" fill="#F7CE82" />
      <circle cx="39" cy="16" r="2.6" fill="#F7CE82" />
      <circle cx="20.5" cy="22" r="1.5" fill={INK} strokeWidth="0" />
      <circle cx="27.5" cy="22" r="1.5" fill={INK} strokeWidth="0" />
      <polygon points="24,25.5 26.4,28 21.6,28" fill={CORAL} />
      <path d="M21.5 30.5 Q24 32.3 26.5 30.5" strokeWidth="1.5" />
      <path d="M13 24 L17.5 25 M13 28 L17.5 27.5 M35 24 L30.5 25 M35 28 L30.5 27.5" strokeWidth="1.2" />
    </Base>
  );
}

/* Wolf — the loyal one */
export function WolfAvatar(props) {
  return (
    <Base {...props}>
      <polygon points="11,6 17,12 12,17" fill="#8E93AD" />
      <polygon points="37,6 31,12 36,17" fill="#8E93AD" />
      <path
        d="M24 9 Q33 9 36 18 L37 26 Q37 36 28 38.5 L26.5 33 Q30 31 29.5 27 L18.5 27 Q18 31 21.5 33 L20 38.5 Q11 36 11 26 L12 18 Q15 9 24 9 Z"
        fill="#8E93AD"
      />
      <path d="M24 13 Q30 13 32 19.5 L32.5 25 Q28 27.5 24 27.5 Q20 27.5 15.5 25 L16 19.5 Q18 13 24 13 Z" fill={PAPER} />
      <circle cx="20" cy="19.5" r="1.6" fill={INK} strokeWidth="0" />
      <circle cx="28" cy="19.5" r="1.6" fill={INK} strokeWidth="0" />
      <polygon points="24,25 26.6,28.2 21.4,28.2" fill={INK} />
      <path d="M24 28.2 L24 31" strokeWidth="1.4" />
      <path d="M20.5 32.5 Q24 34.3 27.5 32.5" strokeWidth="1.4" />
    </Base>
  );
}

/* Fox — the clever one */
export function FoxAvatar(props) {
  return (
    <Base {...props}>
      <polygon points="9,5 18,10 11,17" fill={CORAL} />
      <polygon points="39,5 30,10 37,17" fill={CORAL} />
      <polygon points="11.8,8.5 15.5,11 12.8,13.8" fill={INK} strokeWidth="0" />
      <polygon points="36.2,8.5 32.5,11 35.2,13.8" fill={INK} strokeWidth="0" />
      <path
        d="M24 10 Q32 10 35 19 L36 27 Q36 35 28 38 L26 33.5 Q29.5 31.5 29 28 L19 28 Q18.5 31.5 22 33.5 L20 38 Q12 35 12 27 L13 19 Q16 10 24 10 Z"
        fill={CORAL}
      />
      <path d="M24 14.5 Q29.5 14.5 31.5 20.5 L32 26.5 Q28 29 24 29 Q20 29 16 26.5 L16.5 20.5 Q18.5 14.5 24 14.5 Z" fill={PAPER} />
      <circle cx="20.3" cy="21.5" r="1.6" fill={INK} strokeWidth="0" />
      <circle cx="27.7" cy="21.5" r="1.6" fill={INK} strokeWidth="0" />
      <polygon points="24,26.5 26.6,29.5 21.4,29.5" fill={INK} />
      <path d="M21.5 33 Q24 34.6 26.5 33" strokeWidth="1.4" />
    </Base>
  );
}

/* Masks — the performer (comedy + tragedy) */
export function MasksAvatar(props) {
  return (
    <Base {...props}>
      <path d="M10 8 L26 8 L25 22 Q18 29 11 22 Z" fill={LILAC} />
      <path d="M14 12.5 L17.5 14 L21 12.5" strokeWidth="1.5" />
      <path d="M14 19 Q17.5 15.5 21 19" strokeWidth="1.5" />
      <path d="M22 14 L38 14 L37 28 Q30 35 23 28 Z" fill={CORAL} />
      <path d="M26 18.5 L29.5 20 L33 18.5" strokeWidth="1.5" />
      <path d="M26 25 Q29.5 28.5 33 25" strokeWidth="1.5" />
    </Base>
  );
}

/* Trophy — the champion */
export function TrophyAvatar(props) {
  return (
    <Base {...props}>
      <path d="M13 6 L35 6 L34 17 Q34 24 28 26 L28 30 L20 30 L20 26 Q14 24 14 17 Z" fill={YELLOW} />
      <path d="M13 8 Q6 8 6.5 14 Q7 19 13.5 19.5" fill="none" />
      <path d="M35 8 Q42 8 41.5 14 Q41 19 34.5 19.5" fill="none" />
      <path d="M24 10 L25.4 13.6 L29.2 14 L26.3 16.5 L27.2 20.2 L24 18.2 L20.8 20.2 L21.7 16.5 L18.8 14 L22.6 13.6 Z" fill={PAPER} strokeWidth="1.3" />
      <path d="M20 30 L28 30 L28 34 L20 34 Z" fill={PURPLE_DARK} />
      <rect x="14" y="34" width="20" height="4" rx="2" fill={PURPLE_DARK} />
    </Base>
  );
}

/* Gem — the rare one */
export function GemAvatar(props) {
  return (
    <Base {...props}>
      <polygon points="14,8 34,8 42,18 24,42 6,18" fill={SKY} />
      <polygon points="14,8 24,18 6,18" fill={LILAC} strokeWidth="1.2" />
      <polygon points="34,8 42,18 24,18" fill="#2E7FDB" strokeWidth="1.2" />
      <polygon points="6,18 24,18 24,42" fill="#63B2F5" strokeWidth="1.2" />
      <polygon points="24,18 42,18 24,42" fill="#3E8FE5" strokeWidth="1.2" />
      <path d="M14 8 L24 18 L34 8" strokeWidth="1.4" />
      <path d="M17 12 L19.5 13.5" stroke={PAPER} strokeWidth="1.6" />
    </Base>
  );
}

/* ── the set ──────────────────────────────────────────────────────────────
   Keyed by the stored agent_emoji (the pickers' values, the AGENT_STYLES
   guide glyphs, and the historic '🤖' default). */
const AVATARS = {
  "🤖": BotAvatar,
  "🧠": BrainAvatar,
  "👾": AlienAvatar,
  "🦉": OwlAvatar,
  "🎓": ScholarAvatar,
  "⚡": BoltAvatar,
  "🌟": StarAvatar,
  "🔮": OracleAvatar,
  "🦋": ButterflyAvatar,
  "🎯": TargetAvatar,
  "🚀": RocketAvatar,
  "💡": BulbAvatar,
  "📚": BooksAvatar,
  "🔬": ScopeAvatar,
  "🧭": CompassAvatar,
  "🐝": BeeAvatar,
  "🦁": LionAvatar,
  "🐺": WolfAvatar,
  "🦊": FoxAvatar,
  "🎭": MasksAvatar,
  "🏆": TrophyAvatar,
  "💎": GemAvatar,
};

export const AGENT_AVATAR_KEYS = Object.keys(AVATARS);

/** The agent's avatar, drawn — never an emoji glyph. Unknown keys
 *  (legacy values, empty) draw the bot. */
export function AgentAvatar({ emoji, size = 40, ...props }) {
  const Glyph = AGENT_GLYPHS[norm(emoji)] || BotAvatar;
  return <Glyph size={size} {...props} />;
}

/** Raw key → component lookup for surfaces that compose their own chip. */
export function agentAvatarFor(emoji) {
  return AGENT_GLYPHS[norm(emoji)] || BotAvatar;
}

/* ── people — the learner's own profile avatar ────────────────────────────
   The settings user-picker stores human emoji (graduates, technologists,
   scientists, heroes, mages, teachers — Nigerian skin tones front and
   center). Those keys draw a parametric portrait: skin, hair, accessory
   on the same 48-grid as the agents, so a profile reads identically
   everywhere and no emoji glyph is ever rendered. */
const PORTRAITS = {
  "👨🏾‍🎓": { skin: "#8D5524", hair: "#1F1B18", hairStyle: "short",   accessory: "cap",     shirt: PURPLE },
  "👩🏾‍🎓": { skin: "#8D5524", hair: "#1F1B18", hairStyle: "long",    accessory: "cap",     shirt: SKY },
  "🧑🏾‍🎓": { skin: "#8D5524", hair: "#1F1B18", hairStyle: "sidepart", accessory: "cap",    shirt: MINT },
  "👨🏿‍💻": { skin: "#3B2A20", hair: "#141210", hairStyle: "short",   accessory: "glasses", shirt: PURPLE_DARK },
  "👩🏿‍💻": { skin: "#3B2A20", hair: "#141210", hairStyle: "long",    accessory: "glasses", shirt: CORAL },
  "🧑🏿‍🔬": { skin: "#3B2A20", hair: "#141210", hairStyle: "short",   accessory: "goggles", shirt: PAPER },
  "🦸‍♂️":  { skin: "#8D5524", hair: "#141210", hairStyle: "short",   accessory: "mask",    shirt: CORAL },
  "🦸‍♀️":  { skin: "#8D5524", hair: "#141210", hairStyle: "long",    accessory: "mask",    shirt: MINT },
  "🧙‍♂️":  { skin: "#8D5524", hair: "#E8E4DA", hairStyle: "short",   accessory: "wizard",  shirt: PURPLE, beard: true },
  "🧙‍♀️":  { skin: "#8D5524", hair: "#E8E4DA", hairStyle: "long",    accessory: "wizard",  shirt: LILAC },
  "👨‍🏫":  { skin: "#C68642", hair: "#2A211C", hairStyle: "short",   accessory: "glasses", shirt: YELLOW },
  "👩‍🏫":  { skin: "#C68642", hair: "#2A211C", hairStyle: "bun",     accessory: "glasses", shirt: PINK },
};

const BARE_PORTRAIT = { skin: "#8D5524", hair: "#1F1B18", hairStyle: "short", accessory: "none", shirt: LILAC };

/* Lookups compare on normalized keys (VS16 stripped both sides). */
const PEOPLE = Object.fromEntries(Object.entries(PORTRAITS).map(([k, v]) => [norm(k), v]));
const AGENT_GLYPHS = Object.fromEntries(Object.entries(AVATARS).map(([k, v]) => [norm(k), v]));

function PortraitAvatar({ skin, hair, hairStyle, accessory, shirt, beard, ...props }) {
  return (
    <Base {...props}>
      {/* shoulders */}
      <path d="M8.5 44 Q9 32 24 32 Q39 32 39.5 44" fill={shirt} />
      {/* neck */}
      <path d="M20.8 25.5 L20.8 33 Q24 35.2 27.2 33 L27.2 25.5" fill={skin} />
      {/* head */}
      <circle cx="24" cy="19.5" r="9.6" fill={skin} />
      {/* eyes + smile (drawn before accessories so a mask can cover them) */}
      <circle cx="20.4" cy="19.5" r="1.25" fill={INK} strokeWidth="0" />
      <circle cx="27.6" cy="19.5" r="1.25" fill={INK} strokeWidth="0" />
      <path d="M21 24 Q24 26.2 27 24" strokeWidth="1.6" />
      {/* hair */}
      {hairStyle === "short" && (
        <path d="M14.6 18.5 Q14.2 9.6 24 9.6 Q33.8 9.6 33.4 18.5 Q30.8 13.8 24 13.8 Q17.2 13.8 14.6 18.5 Z" fill={hair} />
      )}
      {hairStyle === "sidepart" && (
        <path d="M14.6 18.5 Q14.2 9.6 24 9.6 Q33.8 9.6 33.4 18.5 Q32.5 12.8 26 13 Q18 13.2 14.6 18.5 Z" fill={hair} />
      )}
      {hairStyle === "long" && (
        <path d="M14.8 21 Q13.2 9 24 9 Q34.8 9 33.2 21 L34.5 29 Q31.8 25.5 31.2 19.5 Q27 15.8 24 15.8 Q21 15.8 16.8 19.5 Q16.2 25.5 13.5 29 Z" fill={hair} />
      )}
      {hairStyle === "bun" && (
        <>
          <circle cx="24" cy="7.4" r="3.7" fill={hair} />
          <path d="M14.8 19 Q14.4 9.8 24 9.8 Q33.6 9.8 33.2 19 Q30 14 24 14 Q18 14 14.8 19 Z" fill={hair} />
        </>
      )}
      {beard && (
        <path d="M16.8 23 Q16.8 32.5 24 33.5 Q31.2 32.5 31.2 23 Q28.5 27.5 24 27.5 Q19.5 27.5 16.8 23 Z" fill={hair} />
      )}
      {/* accessories */}
      {accessory === "cap" && (
        <>
          <path d="M15.5 17.5 Q24 22.5 32.5 17.5 L32.5 20.5 Q24 25.5 15.5 20.5 Z" fill={PURPLE_DARK} />
          <polygon points="24,4 43,11.5 24,19 5,11.5" fill={PURPLE} />
          <path d="M39.5 13.5 L39.5 22.5" strokeWidth="1.6" />
          <circle cx="39.5" cy="24.5" r="2.1" fill={YELLOW} />
        </>
      )}
      {accessory === "glasses" && (
        <>
          <circle cx="20.4" cy="19.5" r="3" strokeWidth="1.6" fill="none" />
          <circle cx="27.6" cy="19.5" r="3" strokeWidth="1.6" fill="none" />
          <path d="M23.4 19.5 L24.6 19.5" strokeWidth="1.6" />
        </>
      )}
      {accessory === "goggles" && (
        <>
          <rect x="14.2" y="16.8" width="19.6" height="6" rx="3" fill="#BFE0FF" strokeWidth="1.5" />
          <path d="M17 21.8 L19 20.5 M22.5 21.8 L24 20.5 M28 21.8 L29 20.8" strokeWidth="1.1" />
        </>
      )}
      {accessory === "mask" && (
        <>
          <path d="M14.4 15.8 L33.6 15.8 L32.6 21.6 Q24 26.2 15.4 21.6 Z" fill={PURPLE_DARK} />
          <path d="M17.5 18.3 L21 18.3 M27 18.3 L30.5 18.3" stroke={PAPER} strokeWidth="1.8" />
        </>
      )}
      {accessory === "wizard" && (
        <>
          <polygon points="24,2.5 29.5,13.5 18.5,13.5" fill={PURPLE} />
          <path d="M12.5 14.5 Q24 19.5 35.5 14.5 L35.5 17 Q24 22 12.5 17 Z" fill={PURPLE_DARK} />
          <path d="M27.5 5.5 L28.4 7.6 L30.5 8.5 L28.4 9.4 L27.5 11.5 L26.6 9.4 L24.5 8.5 L26.6 7.6 Z" fill={YELLOW} strokeWidth="1.2" />
        </>
      )}
    </Base>
  );
}

export const PROFILE_AVATAR_KEYS = Object.keys(PORTRAITS);

/** The learner's own profile avatar, drawn. Unknown/missing keys draw
 *  the bare portrait (the AVATAR_FALLBACK look, as a component). */
export function ProfileAvatar({ emoji, size = 40, ...props }) {
  const cfg = PEOPLE[norm(emoji)] || BARE_PORTRAIT;
  return <PortraitAvatar size={size} {...cfg} {...props} />;
}

/** One lookup for surfaces that show either kind (settings' shared
 *  AvatarCircle): agent glyph first, then a person portrait, then the
 *  bare portrait — never an emoji glyph. */
export function DrawnAvatar({ emoji, size = 40, ...props }) {
  const key = norm(emoji);
  if (AGENT_GLYPHS[key]) return <AgentAvatar emoji={key} size={size} {...props} />;
  return <ProfileAvatar emoji={key} size={size} {...props} />;
}
