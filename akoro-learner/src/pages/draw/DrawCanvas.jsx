/**
 * DrawCanvas — the Excalidraw canvas, isolated so it (and the heavy Excalidraw
 * bundle) only loads when the user actually picks a canvas engine. Keeping it
 * out of DrawPage means the default SVG illustration never depends on
 * Excalidraw mounting successfully.
 *
 * Props:
 *   payload: { kind: 'elements', elements } | { kind: 'mermaid', mermaid } | null
 */
import { useState, useEffect, useCallback } from 'react';
import { Excalidraw, convertToExcalidrawElements } from '@excalidraw/excalidraw';
import { parseMermaidToExcalidraw } from '@excalidraw/mermaid-to-excalidraw';

export default function DrawCanvas({ payload }) {
  const [api, setApi] = useState(null);

  const render = useCallback(async () => {
    if (!api || !payload) return;
    try {
      let elements = payload.elements;
      let files;
      if (payload.kind === 'mermaid') {
        const r = await parseMermaidToExcalidraw(payload.mermaid, { fontSize: 16 });
        elements = r.elements; files = r.files;
      }
      const els = convertToExcalidrawElements(elements || []);
      api.updateScene({ elements: els });
      if (files) api.addFiles(Object.values(files));
      if (els.length) api.scrollToContent(els, { fitToContent: true, animate: true });
    } catch (e) {
      console.error('[DrawCanvas] render failed:', e);
    }
  }, [api, payload]);

  useEffect(() => { render(); }, [render]);

  return <Excalidraw excalidrawAPI={(a) => setApi(a)} />;
}
