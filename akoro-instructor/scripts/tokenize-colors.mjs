#!/usr/bin/env node
/**
 * tokenize-colors.mjs — the console rebuild's mechanical colour step
 * (reference/Akoro Console Rebuild — Plan.md, Phase 3): swaps constants.js
 * colours and the Bachs `BX.*` palette for the theme-aware names in
 * src/theme/colors.js, so a page follows the ?ui= switch and looks exactly
 * the same on legacy.
 *
 *   node scripts/tokenize-colors.mjs src/pages/Foo.jsx [more files…]
 *
 * It does only the safe, table-driven part and prints what it left for a
 * person: hex colours written inline, lucide icons (→ <Ico lucide ti/>), and
 * any `${X}..` hex-alpha it couldn't turn into tint(). Review every diff.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const NAMES = { AMBER: 'C.brand', INK: 'C.ink', MUTED2: 'C.muted2', MUTED: 'C.muted', BORDER: 'C.border', LIGHT: 'C.bg', FONT: 'C.font' };
const BX = { white: 'C.surface', primary: 'C.bxPrimary', primaryHover: 'C.bxPrimary', ink: 'C.bxInk', muted: 'C.bxMuted', border: 'C.bxBorder', bg: 'C.bxBg', sidebarBg: 'C.bxBg', font: 'C.bxFont' };
const pct = (hex2) => Math.round((parseInt(hex2, 16) / 255) * 100);

export function tokenize(src) {
  let s = src;
  // `${AMBER}18` (a whole template literal) → tint(9); `${color}18` → tint(9, color)
  s = s.replace(/`\$\{AMBER\}([0-9A-Fa-f]{2})`/g, (_, a) => `tint(${pct(a)})`);
  s = s.replace(/`\$\{([a-zA-Z_.]+)\}([0-9A-Fa-f]{2})`/g, (m, v, a) => (['GREEN', 'RED', 'BLUE', 'PURPLE', 'GOLD'].includes(v) ? m : `tint(${pct(a)}, ${v})`));
  // inside a longer template: ${AMBER}44 → ${tint(27)}
  s = s.replace(/\$\{AMBER\}([0-9A-Fa-f]{2})(?![0-9A-Fa-f])/g, (_, a) => `\${tint(${pct(a)})}`);
  // white TEXT stays white; white SURFACES follow the theme
  s = s.replace(/color:\s*WHITE\b/g, "color: '#fff'").replace(/color=\{WHITE\}/g, "color=\"#fff\"");
  s = s.replace(/\bWHITE\b(?!\s*[,}]\s*from)/g, 'C.surface');
  for (const [k, v] of Object.entries(NAMES)) s = s.replace(new RegExp(`(?<![\\w.'"])${k}(?![\\w'"])`, 'g'), v);
  s = s.replace(/\bBX\.(\w+)/g, (m, k) => BX[k] || m);
  // imports: drop the swapped names from constants.js, add colors.js
  s = s.replace(/import \{([^}]*)\} from '((?:\.\.\/)+|\.\/)constants\.js';/, (m, names, rel) => {
    const keep = names.split(',').map((n) => n.trim()).filter((n) => n && !['C.brand', 'C.ink', 'C.muted2', 'C.muted', 'C.border', 'C.bg', 'C.font', 'C.surface', 'AMBER', 'INK', 'MUTED', 'MUTED2', 'BORDER', 'LIGHT', 'WHITE', 'FONT'].includes(n));
    const themeRel = `${rel}theme/colors.js`;
    return `${keep.length ? `import { ${keep.join(', ')} } from '${rel}constants.js';\n` : ''}import { C, tint } from '${themeRel}';`;
  });
  // the local Bachs palette object is no longer read
  s = s.replace(/\n\/\/ Bachs design tokens[^\n]*\nconst BX = \{[\s\S]*?\};\n/, '\n');
  return s;
}

export function leftovers(s) {
  const out = [];
  const hex = [...s.matchAll(/'#[0-9A-Fa-f]{3,8}'/g)].map((m) => m[0]);
  if (hex.length) out.push(`inline hex colours: ${[...new Set(hex)].join(' ')}`);
  const lucide = s.match(/import \{([^}]*)\} from 'lucide-react'/);
  if (lucide) out.push(`lucide icons to wrap in <Ico lucide ti/>: ${lucide[1].trim()}`);
  if (/\$\{[A-Za-z_.]+\}[0-9A-Fa-f]{2}/.test(s)) out.push('hex-alpha on a colour left as is (status hues are fine)');
  if (/\bBX\b/.test(s)) out.push('BX still referenced');
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const f of process.argv.slice(2)) {
    const before = readFileSync(f, 'utf8');
    const after = tokenize(before);
    if (after !== before) writeFileSync(f, after);
    console.log(`${path.relative(process.cwd(), f)}${after === before ? ' (unchanged)' : ''}`);
    for (const l of leftovers(after)) console.log(`  · ${l}`);
  }
}
