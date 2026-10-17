/*
 * PaperFrame — a paper rendered by the server's template
 * (akoro-api/modules/self-study/paperTemplate.js), shown as it prints: the
 * page is laid out at desktop width (A4 sheets, the template's own CSS and
 * pagination) and scaled to fit whatever holds it — a chat panel, the
 * grading view, a phone. `marks` ({ [index]: { awarded, comment } }) fill
 * the marks boxes live while grading.
 *
 *   printPaperHtml(html, title)   print / Save as PDF the same page, alone
 *
 * Kept identical in akoro-instructor/src/components/paper and
 * akoro-learner/src/components/activity (a contract test checks).
 */
import { useEffect, useRef, useState } from 'react';

const PAGE_W = 840;   // the template's desktop width (its phone layout starts below 820px)

const withTitle = (html, title) => (title ? String(html).replace(/<title>[\s\S]*?<\/title>/, `<title>${String(title).replace(/[<>&]/g, '')}</title>`) : html);

export default function PaperFrame({ html, marks = null, title = 'Paper', style }) {
  const wrap = useRef(null);
  const frame = useRef(null);
  const [width, setWidth] = useState(PAGE_W);
  const [height, setHeight] = useState(900);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width || PAGE_W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const onMsg = (e) => {
      if (e.source !== frame.current?.contentWindow) return;
      if (e.data?.type === 'akoro-paper-height' && e.data.height > 0) setHeight(e.data.height);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  const postMarks = () => {
    if (marks) frame.current?.contentWindow?.postMessage({ type: 'akoro-paper-marks', marks }, '*');
  };
  useEffect(postMarks, [marks]);   // eslint-disable-line react-hooks/exhaustive-deps

  const scale = Math.min(1, width / PAGE_W);
  return (
    <div ref={wrap} style={{ width: '100%', height: html ? Math.ceil(height * scale) : 0, overflow: 'hidden', ...style }}>
      {html && (
        <iframe ref={frame} title={title} srcDoc={html} onLoad={postMarks}
          style={{ display: 'block', width: PAGE_W, height, border: 0, transform: `scale(${scale})`, transformOrigin: '0 0', background: 'transparent' }} />
      )}
    </div>
  );
}

/** Print (Save as PDF) a server-rendered paper alone, once its sheets are laid out. */
export function printPaperHtml(html, title = 'Paper') {
  return new Promise((resolve) => {
    const f = document.createElement('iframe');
    f.setAttribute('aria-hidden', 'true');
    Object.assign(f.style, { position: 'fixed', left: '-10000px', top: '0', width: `${PAGE_W}px`, height: '1200px', border: '0' });
    let printed = false;
    const go = () => {
      if (printed) return;
      printed = true;
      window.removeEventListener('message', onMsg);
      try { f.contentWindow.focus(); f.contentWindow.print(); } catch { /* blocked: nothing to do */ }
      setTimeout(() => { f.remove(); resolve(); }, 1500);
    };
    const onMsg = (e) => { if (e.source === f.contentWindow && e.data?.type === 'akoro-paper-height') setTimeout(go, 150); };
    window.addEventListener('message', onMsg);
    f.srcdoc = withTitle(html, title);
    document.body.appendChild(f);
    setTimeout(go, 5000);   // the page never reported: print what is there
  });
}
