/**
 * samples.js — hand-authored reference outputs so the /draw comparison page can
 * show real quality on first load, before any live generation. These are the
 * SAME two formats the two engines produce:
 *   • svg      — a rich, teacher-style illustration (SVG string)
 *   • elements — Excalidraw skeleton elements (boxes/arrows/text)
 *
 * The SVG below is authored the way the SVG engine (Claude/Opus) is prompted to
 * draw: labelled physics with field lines, a coil, a bulb, a formula and notes.
 * Every stroke path carries pathLength="1" so the page can animate them drawing
 * on, one after another, like a teacher at the board.
 */

export const SAMPLE_EM_INDUCTION_SVG = `
<svg viewBox="0 0 820 500" xmlns="http://www.w3.org/2000/svg" font-family="'Nunito', sans-serif">
  <!-- title -->
  <text x="410" y="42" text-anchor="middle" font-size="26" font-weight="800" fill="#1f2937">Electromagnetic Induction</text>

  <!-- magnet -->
  <g stroke-linecap="round">
    <rect x="70" y="210" width="150" height="60" rx="6" fill="#e5e7eb" stroke="#6b7280" stroke-width="2.5"/>
    <rect x="145" y="210" width="75" height="60" rx="0" fill="#ef4444" opacity="0.85"/>
    <text x="107" y="248" font-size="26" font-weight="900" fill="#374151">S</text>
    <text x="176" y="248" font-size="26" font-weight="900" fill="#ffffff">N</text>
  </g>
  <text x="95" y="196" font-size="14" font-weight="700" fill="#374151">Moving magnet</text>
  <path class="stroke" pathLength="1" d="M255 240 h70" stroke="#374151" stroke-width="2.5" fill="none" marker-end="url(#ah)"/>
  <text x="270" y="228" font-size="13" font-weight="700" fill="#374151">motion</text>

  <!-- magnetic field lines from N pole -->
  <g class="field" stroke="#7c3aed" stroke-width="2" fill="none" opacity="0.9">
    <path class="stroke" pathLength="1" d="M222 230 C 300 180, 380 190, 430 235" marker-end="url(#fa)"/>
    <path class="stroke" pathLength="1" d="M222 240 C 300 220, 380 220, 430 245"/>
    <path class="stroke" pathLength="1" d="M222 250 C 300 300, 380 290, 430 255" marker-end="url(#fa)"/>
    <path class="stroke" pathLength="1" d="M222 258 C 300 330, 390 330, 445 268"/>
  </g>
  <text x="300" y="360" font-size="13" font-weight="700" fill="#7c3aed">Magnetic field</text>

  <!-- coil (spring of arcs) -->
  <g class="coil" stroke="#b45309" stroke-width="3.5" fill="none" stroke-linecap="round">
    <path class="stroke" pathLength="1" d="M445 210 a15 30 0 1 1 0 60"/>
    <path class="stroke" pathLength="1" d="M462 210 a15 30 0 1 1 0 60"/>
    <path class="stroke" pathLength="1" d="M479 210 a15 30 0 1 1 0 60"/>
    <path class="stroke" pathLength="1" d="M496 210 a15 30 0 1 1 0 60"/>
    <path class="stroke" pathLength="1" d="M513 210 a15 30 0 1 1 0 60"/>
  </g>
  <text x="452" y="300" font-size="13" font-weight="700" fill="#b45309">Coil</text>

  <!-- wires to bulb -->
  <g class="stroke wire" stroke="#334155" stroke-width="2.5" fill="none" stroke-linecap="round">
    <path class="stroke" pathLength="1" d="M513 220 C 580 200, 600 170, 625 160"/>
    <path class="stroke" pathLength="1" d="M513 262 C 590 285, 610 250, 625 205"/>
  </g>

  <!-- bulb -->
  <g>
    <circle class="glow" cx="655" cy="175" r="30" fill="#fde68a" opacity="0.55"/>
    <circle cx="655" cy="175" r="22" fill="#fef3c7" stroke="#f59e0b" stroke-width="2.5"/>
    <path class="stroke" pathLength="1" d="M646 178 l6 -8 l6 10 l6 -8" stroke="#f59e0b" stroke-width="2" fill="none"/>
    <rect x="648" y="196" width="14" height="9" rx="2" fill="#9ca3af"/>
    <g stroke="#f59e0b" stroke-width="2" stroke-linecap="round">
      <path class="stroke" pathLength="1" d="M655 133 v-12"/>
      <path class="stroke" pathLength="1" d="M693 150 l9 -8"/>
      <path class="stroke" pathLength="1" d="M617 150 l-9 -8"/>
    </g>
  </g>
  <text x="628" y="240" font-size="14" font-weight="800" fill="#b45309">Bulb glows</text>

  <!-- induced current arrow -->
  <path class="stroke" pathLength="1" d="M505 285 q 12 30 -18 48" stroke="#0ea5e9" stroke-width="2.5" fill="none" marker-end="url(#ca)"/>
  <text x="400" y="352" font-size="13" font-weight="700" fill="#0ea5e9">Induced current</text>

  <!-- formula -->
  <g>
    <rect x="590" y="300" width="180" height="56" rx="10" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.5"/>
    <text x="680" y="336" text-anchor="middle" font-size="24" font-weight="800" fill="#111827" font-style="italic">&#949; = &#8722;N d&#934;/dt</text>
  </g>

  <!-- caption -->
  <text x="120" y="410" font-size="14" font-weight="700" fill="#0d9488">When the magnet moves near the coil, the magnetic flux</text>
  <text x="120" y="430" font-size="14" font-weight="700" fill="#0d9488">changes, so a current is induced.</text>

  <!-- key insight -->
  <g>
    <rect x="500" y="392" width="270" height="66" rx="10" fill="#ecfeff" stroke="#67e8f9" stroke-width="1.5"/>
    <text x="516" y="414" font-size="12" font-weight="900" fill="#0891b2">KEY INSIGHT</text>
    <text x="516" y="434" font-size="13" font-weight="700" fill="#155e75">Changing magnetic flux</text>
    <text x="516" y="450" font-size="13" font-weight="700" fill="#155e75">creates electric current.</text>
  </g>

  <defs>
    <marker id="ah" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 z" fill="#374151"/></marker>
    <marker id="fa" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 z" fill="#7c3aed"/></marker>
    <marker id="ca" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 z" fill="#0ea5e9"/></marker>
  </defs>
</svg>`.trim();

// A representative Excalidraw-elements version of the SAME concept, to show the
// honest contrast: boxes + arrows + labels render in the native hand-drawn
// style, but organic field lines / coil become straight arrows.
export const SAMPLE_EM_INDUCTION_ELEMENTS = [
  { type: 'rectangle', x: 60, y: 200, width: 150, height: 60, label: { text: 'S      N\\nMagnet' }, backgroundColor: '#ffc9c9' },
  { type: 'arrow', x: 220, y: 230, width: 120, height: 0, label: { text: 'field' }, strokeColor: '#7048e8' },
  { type: 'ellipse', x: 360, y: 190, width: 90, height: 90, label: { text: 'Coil' }, strokeColor: '#e8590c' },
  { type: 'arrow', x: 455, y: 220, width: 110, height: -30, strokeColor: '#1971c2' },
  { type: 'ellipse', x: 580, y: 150, width: 70, height: 70, label: { text: 'Bulb\\nglows' }, backgroundColor: '#ffec99' },
  { type: 'text', x: 360, y: 320, text: 'Changing flux induces current:  ε = −N dΦ/dt', fontSize: 20 },
];

export const SAMPLES = [
  {
    id: 'em-induction',
    prompt: 'How electromagnetic induction works',
    svg: SAMPLE_EM_INDUCTION_SVG,
    elements: SAMPLE_EM_INDUCTION_ELEMENTS,
  },
];
