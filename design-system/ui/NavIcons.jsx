/**
 * NavIcons.jsx — the brand nav icon set for the learner app: hand-drawn
 * SVGs on a 48×48 grid, ink outlines (INK, 2px, round joins) and the app
 * palette. One set, every nav surface — the mobile bottom nav
 * (LearnerDashboard), the tablet/desktop sidebar (AppShell) and the dev
 * shell preview (/dev/shell) — so a destination reads identically
 * everywhere an emoji used to.
 *
 * Learn / Discover / Rankings / Battles / Agent and the "More" set
 * (Library, Communities, Wallet, Settings) are the provided designs,
 * unchanged. Activities + Gradebook — the two school-tier-only "More"
 * rows — were not in that set, so they are drawn below in the same style
 * (clipboard checklist; report card with an A+).
 *
 * Nav surfaces render through <NavIcon name={key} active={bool}/>: it
 * maps the app's nav keys ("sessions" is Learn, "discovery" Discover,
 * plus the sidebar's page keys) to the icons and applies the shared
 * active/inactive treatment (dimmed to 60% when not current). TabIcon
 * keeps a raw name→icon lookup for anything that just wants an icon by
 * its design name.
 */

const INK = "#2B2A4C";
const PAPER = "#FFF8E7";
const PURPLE = "#6D3FD9";
const PURPLE_DARK = "#5B33C4";
const YELLOW = "#FFC93C";
const SKY = "#4DA3FF";
const MINT = "#38C9A0";
const CORAL = "#FF7A6B";

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

/* Learn: open textbook with a spark of knowledge */
export function LearnIcon(props) {
  return (
    <Base {...props}>
      <path
        d="M2 14 V41 Q13 37 24 42 Q35 37 46 41 V14 Q35 10 24 15 Q13 10 2 14 Z"
        fill={PURPLE}
      />
      <path d="M5 13.5 Q14 10.5 23 15 V38.5 Q14 35 5 38 Z" fill={PAPER} />
      <path d="M43 13.5 Q34 10.5 25 15 V38.5 Q34 35 43 38 Z" fill={PAPER} />
      <g stroke="#B9B3D6" strokeWidth="1.5">
        <path d="M8.5 20 L19 22.5" />
        <path d="M8.5 26 L19 28.5" />
        <path d="M8.5 32 L15 33.5" />
        <path d="M39.5 20 L29 22.5" />
        <path d="M39.5 26 L29 28.5" />
        <path d="M39.5 32 L33 33.5" />
      </g>
      <polygon
        points="24,2 25.3,5.2 28.8,5.5 26.1,7.7 26.9,11.1 24,9.2 21.1,11.1 21.9,7.7 19.2,5.5 22.7,5.2"
        fill={YELLOW}
        strokeWidth="1.5"
      />
    </Base>
  );
}

/* Discover: classroom globe on a stand */
export function DiscoverIcon(props) {
  return (
    <Base {...props}>
      <path d="M8 30 A18.4 18.4 0 0 0 40 30" stroke={INK} strokeWidth="5.5" />
      <path d="M8 30 A18.4 18.4 0 0 0 40 30" stroke={YELLOW} strokeWidth="2" />
      <rect x="22.5" y="38" width="3" height="4" fill={YELLOW} />
      <rect x="15" y="41" width="18" height="4.5" rx="2" fill={YELLOW} />
      <circle cx="24" cy="21" r="15" fill={SKY} />
      <path
        d="M15 15 Q19 11 23 14 Q24 18 20 20 Q16 21 14 19 Z"
        fill={MINT}
        strokeWidth="1.5"
      />
      <path
        d="M27 22 Q32 20 34 24 Q33 29 29 29 Q26 26 27 22 Z"
        fill={MINT}
        strokeWidth="1.5"
      />
      <path d="M12 16 Q14 11 19 9" stroke="#FFFFFF" strokeOpacity="0.75" strokeWidth="2" />
    </Base>
  );
}

/* Rankings: podium with a gold star */
export function RankingsIcon(props) {
  const num = {
    stroke: "none",
    fill: "#FFFFFF",
    fontFamily: "system-ui, sans-serif",
    fontWeight: 800,
    textAnchor: "middle",
  };
  return (
    <Base {...props}>
      <rect x="3" y="27" width="14" height="15" fill={SKY} />
      <rect x="17" y="19" width="14" height="23" fill={PURPLE} />
      <rect x="31" y="31" width="14" height="11" fill={CORAL} />
      <text x="10" y="38" fontSize="9" {...num}>2</text>
      <text x="24" y="33" fontSize="11" {...num}>1</text>
      <text x="38" y="40" fontSize="8" {...num}>3</text>
      <polygon
        points="24,3 25.8,7.6 30.7,7.8 26.9,10.9 28.1,15.7 24,13 19.9,15.7 21.1,10.9 17.3,7.8 22.2,7.6"
        fill={YELLOW}
      />
    </Base>
  );
}

function Pencil({ angle, color }) {
  return (
    <g transform={`translate(24 24) rotate(${angle}) scale(1.1) translate(-24 -24)`}>
      <rect x="20" y="12" width="8" height="24" fill={color} />
      <polygon points="20,36 28,36 24,44" fill="#F2C79B" />
      <polygon points="22.6,41.2 25.4,41.2 24,44" fill={INK} strokeWidth="0.5" />
      <rect x="20" y="9" width="8" height="3.5" fill="#C5CCD8" />
      <rect x="20" y="4" width="8" height="5" rx="2" fill={CORAL} />
      <line x1="24" y1="13.5" x2="24" y2="35" stroke={INK} strokeOpacity="0.25" strokeWidth="1.2" />
    </g>
  );
}

/* Battles: two crossed pencils */
export function BattlesIcon(props) {
  return (
    <Base {...props}>
      <Pencil angle={-42} color={YELLOW} />
      <Pencil angle={42} color={SKY} />
    </Base>
  );
}

/* Agent: friendly robot tutor in a graduation cap */
export function AgentIcon(props) {
  return (
    <Base {...props}>
      <rect x="5" y="26" width="4.5" height="9" rx="2.2" fill={YELLOW} />
      <rect x="38.5" y="26" width="4.5" height="9" rx="2.2" fill={YELLOW} />
      <rect x="16" y="41" width="16" height="5" rx="2.5" fill={PURPLE} />
      <rect x="9" y="19" width="30" height="22" rx="7" fill="#E8EEFF" />
      <rect x="13" y="25" width="22" height="11" rx="5" fill={INK} />
      <circle cx="19.5" cy="30" r="2.3" fill="#5EEAD4" stroke="none" />
      <circle cx="28.5" cy="30" r="2.3" fill="#5EEAD4" stroke="none" />
      <path d="M21 33.5 Q24 35.3 27 33.5" stroke="#5EEAD4" strokeWidth="1.5" />
      <path
        d="M14.5 20 V13.5 H33.5 V20 Q24 23 14.5 20 Z"
        fill={PURPLE_DARK}
      />
      <polygon points="24,4 44,11 24,18 4,11" fill={PURPLE} />
      <path d="M24 11 L38 13 V20" stroke={YELLOW} strokeWidth="1.5" />
      <rect x="36.8" y="19" width="2.4" height="4.5" rx="1" fill={YELLOW} strokeWidth="1" />
      <circle cx="24" cy="11" r="1.8" fill={YELLOW} strokeWidth="1" />
    </Base>
  );
}

/* ---------- New: secondary nav ("More") icons ---------- */

/* Library: a stack of books with a bookmark ribbon */
export function LibraryIcon(props) {
  return (
    <Base {...props}>
      <g transform="rotate(-8 24 24)">
        <rect x="8" y="28" width="30" height="8" rx="1.5" fill={SKY} />
      </g>
      <g transform="rotate(5 24 24)">
        <rect x="9" y="18" width="28" height="8" rx="1.5" fill={CORAL} />
      </g>
      <rect x="8" y="9" width="30" height="9" rx="1.5" fill={PURPLE} />
      <rect x="8" y="9" width="30" height="2.6" fill={PURPLE_DARK} strokeWidth="0" />
      <path d="M29 9 V21 L26 18.3 L23 21 V9 Z" fill={YELLOW} />
      <path d="M11 12.8 H22" stroke="#C9B6F2" strokeWidth="1.5" />
    </Base>
  );
}

/* Communities: two overlapping speech bubbles */
export function CommunitiesIcon(props) {
  return (
    <Base {...props}>
      <path
        d="M4 13 h22 a4 4 0 0 1 4 4 v9 a4 4 0 0 1 -4 4 h-9 l-7 6 v-6 h-6 a4 4 0 0 1 -4 -4 v-9 a4 4 0 0 1 4 -4 Z"
        fill={SKY}
      />
      <path
        d="M22 17 h18 a4 4 0 0 1 4 4 v8 a4 4 0 0 1 -4 4 h-4 v5 l-6.5 -5 h-7.5 a4 4 0 0 1 -4 -4 v-8 a4 4 0 0 1 4 -4 Z"
        fill={PURPLE}
      />
      <circle cx="11" cy="21.5" r="1.7" fill={PAPER} stroke="none" />
      <circle cx="16.5" cy="21.5" r="1.7" fill={PAPER} stroke="none" />
      <circle cx="30" cy="25.5" r="1.7" fill={PAPER} stroke="none" />
      <circle cx="35.5" cy="25.5" r="1.7" fill={PAPER} stroke="none" />
    </Base>
  );
}

/* Wallet: billfold with a coin, matching the in-app credit coin */
export function WalletIcon(props) {
  return (
    <Base {...props}>
      <rect x="4" y="14" width="40" height="27" rx="6" fill={PURPLE_DARK} />
      <path d="M4 20 Q24 26 44 20 V34 Q24 40 4 34 Z" fill={PURPLE} strokeWidth="1.5" />
      <circle cx="33" cy="27" r="7.5" fill={YELLOW} />
      <circle cx="33" cy="27" r="4" fill="none" stroke={INK} strokeOpacity="0.4" strokeWidth="1.3" />
      <path d="M30 24.5 Q33 22.5 36 24.5" stroke="#FFFFFF" strokeOpacity="0.7" strokeWidth="1.3" />
    </Base>
  );
}

/* Settings: a friendly gear with a highlight spark */
export function SettingsIcon(props) {
  const teeth = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <Base {...props}>
      <g>
        {teeth.map((deg) => (
          <rect
            key={deg}
            x="20.5"
            y="3.5"
            width="7"
            height="9"
            rx="2"
            fill={PURPLE}
            transform={`rotate(${deg} 24 24)`}
          />
        ))}
      </g>
      <circle cx="24" cy="24" r="14.5" fill={PURPLE_DARK} />
      <circle cx="24" cy="24" r="8" fill={PAPER} />
      <circle cx="24" cy="24" r="3" fill={INK} strokeWidth="0" />
      <polygon
        points="35,8 36,10.4 38.4,10.7 36.6,12.4 37.1,14.8 35,13.5 32.9,14.8 33.4,12.4 31.6,10.7 34,10.4"
        fill={YELLOW}
      />
    </Base>
  );
}

/* ---------- App additions: the two school-tier "More" rows the provided
   set didn't cover, drawn in the same style (ink outline, same palette,
   same 48 grid) so the sidebar never mixes emoji back in. ---------- */

/* Activities: clipboard checklist with ticks and a done badge */
export function ActivitiesIcon(props) {
  const box = { fill: "#FFFFFF", strokeWidth: 1.5 };
  return (
    <Base {...props}>
      <rect x="9" y="6" width="30" height="38" rx="4" fill={PAPER} />
      <rect x="17.5" y="3" width="13" height="7" rx="2.5" fill={SKY} />
      <rect x="21.5" y="1.2" width="5" height="3.5" rx="1.75" fill="#C5CCD8" strokeWidth="1" />
      <rect x="13.5" y="14" width="6" height="6" rx="1.5" {...box} />
      <rect x="13.5" y="22" width="6" height="6" rx="1.5" {...box} />
      <rect x="13.5" y="30" width="6" height="6" rx="1.5" {...box} />
      <path d="M15.2 17 L16.7 18.6 L19.6 15.2" stroke={MINT} strokeWidth="1.8" />
      <path d="M15.2 25 L16.7 26.6 L19.6 23.2" stroke={MINT} strokeWidth="1.8" />
      <path d="M15.2 33 L16.7 34.6 L19.6 31.2" stroke={MINT} strokeWidth="1.8" />
      <path d="M23.5 17 H32" stroke="#B9B3D6" strokeWidth="1.5" />
      <path d="M23.5 25 H32" stroke="#B9B3D6" strokeWidth="1.5" />
      <path d="M23.5 33 H28.5" stroke="#B9B3D6" strokeWidth="1.5" />
      <circle cx="34.5" cy="37" r="6.5" fill={YELLOW} />
      <path d="M31.6 37 L33.6 39.2 L37.6 34.9" strokeWidth="2" />
    </Base>
  );
}

/* Gradebook: report card with an A+ and a gold star */
export function GradebookIcon(props) {
  const grade = {
    stroke: "none",
    fill: INK,
    fontFamily: "system-ui, sans-serif",
    fontWeight: 900,
    textAnchor: "middle",
  };
  return (
    <Base {...props}>
      <rect x="8" y="5" width="32" height="38" rx="4" fill={PAPER} />
      <rect x="8" y="5" width="32" height="10" rx="4" fill={PURPLE} />
      <rect x="8" y="10" width="32" height="5" fill={PURPLE} strokeWidth="0" />
      <text x="24" y="29.5" fontSize="15" {...grade}>A+</text>
      <rect x="13.5" y="33.5" width="4.5" height="4.5" rx="1" fill={MINT} strokeWidth="1" />
      <rect x="13.5" y="38.3" width="4.5" height="4.5" rx="1" fill={CORAL} strokeWidth="1" />
      <path d="M21 35.8 H34" stroke="#B9B3D6" strokeWidth="1.5" />
      <path d="M21 40.6 H30" stroke="#B9B3D6" strokeWidth="1.5" />
      <polygon
        points="34.5,6 35.6,9 38.8,9.1 36.2,11.1 37.2,14.1 34.5,12.3 31.9,14.1 32.8,11.1 30.2,9.1 33.4,9"
        fill={YELLOW}
        strokeWidth="1.5"
      />
    </Base>
  );
}

export const TAB_ICONS = {
  learn: LearnIcon,
  discover: DiscoverIcon,
  rankings: RankingsIcon,
  battles: BattlesIcon,
  agent: AgentIcon,
};

export const MORE_ICONS = {
  library: LibraryIcon,
  communities: CommunitiesIcon,
  wallet: WalletIcon,
  settings: SettingsIcon,
};

export function TabIcon({ name, size = 48, ...props }) {
  const Icon = TAB_ICONS[name] || MORE_ICONS[name];
  return Icon ? <Icon size={size} {...props} /> : null;
}

/* The app's nav keys → icons. Tab keys are the dashboard's ?tab= values
   ("sessions" is Learn); the rest are the sidebar's "More" rows,
   including the two school-tier additions above. */
export const NAV_ICONS = {
  sessions: LearnIcon,
  discovery: DiscoverIcon,
  rankings: RankingsIcon,
  battles: BattlesIcon,
  agent: AgentIcon,
  library: LibraryIcon,
  activities: ActivitiesIcon,
  gradebook: GradebookIcon,
  communities: CommunitiesIcon,
  wallet: WalletIcon,
  settings: SettingsIcon,
};

/* Nav surfaces render through this: looks the icon up by nav key and
   applies the shared active/inactive treatment — full colour for the
   current destination, dimmed to 60% otherwise. */
export function NavIcon({ name, size = 24, active = true, style }) {
  const Icon = NAV_ICONS[name];
  if (!Icon) return null;
  return (
    <Icon
      size={size}
      style={{ opacity: active ? 1 : 0.6, transition: "opacity 120ms", ...style }}
    />
  );
}
