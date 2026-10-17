/*
 * printSheet — print (or Save as PDF) a paper sheet on its own: the sheet is
 * rendered into a hidden frame, its images are waited for, and the browser's
 * print dialog opens with the paper alone. The frame's title is the PDF's
 * suggested file name. Kept identical in akoro-instructor and akoro-learner.
 */
import { createRoot } from 'react-dom/client';

const esc = (s) => String(s || '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

export async function printSheet(element, { title = 'paper' } = {}) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '210mm', height: '297mm', border: '0', opacity: '0', pointerEvents: 'none' });
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title></head><body style="margin:0;background:#fff"><div id="sheet"></div></body></html>`);
  doc.close();
  const root = createRoot(doc.getElementById('sheet'));
  try {
    root.render(element);
    // Let the sheet render and its drawings load (they arrive through the app's own fetch).
    await tick(400);
    for (let n = 0; n < 40; n++) {
      const imgs = [...doc.images];
      const pending = [...doc.querySelectorAll('.aks-drawing')].some((fig) => !fig.querySelector('img'));
      const waiting = imgs.some((img) => !img.complete) || pending;
      if (!waiting) break;
      await tick(150);
    }
    frame.contentWindow.focus();
    frame.contentWindow.print();
  } finally {
    // The dialog blocks on most browsers; give the rest a moment before tidying up.
    setTimeout(() => { root.unmount(); frame.remove(); }, 1500);
  }
}
