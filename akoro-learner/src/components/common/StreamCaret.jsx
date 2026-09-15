/*
 * Shared streaming caret — the blinking cursor at the end of a reply that
 * is still being generated. A block caret (not a thin one) reads as
 * "text is arriving here" even at 13px. Used by the teaching session's
 * live bubbles and the AI chat's streaming answer/thought stream.
 * Honours prefers-reduced-motion with a static caret.
 */
export const STREAM_CARET_CSS = `
@keyframes ak-caret-blink{0%,55%{opacity:1}56%,100%{opacity:0}}
.ak-caret{display:inline-block;width:8px;height:1em;margin-left:2px;vertical-align:-0.15em;
  background:currentColor;border-radius:1.5px;animation:ak-caret-blink 1s step-end infinite;}
@media (prefers-reduced-motion: reduce){.ak-caret{animation:none;opacity:.75}}
`;

export default function StreamCaret() {
  return (
    <>
      <style>{STREAM_CARET_CSS}</style>
      <span className="ak-caret" aria-hidden="true"/>
    </>
  );
}
