/**
 * DrawCanvas — the Excalidraw canvas, isolated so it (and the heavy Excalidraw
 * bundle) only loads when the user actually picks a canvas engine. Keeping it
 * out of DrawPage means the default SVG illustration never depends on
 * Excalidraw mounting successfully.
 *
 * Props:
 *   payload:  { kind: 'elements', elements } | { kind: 'mermaid', mermaid } | null
 *   sketch:   boolean — start blank with the freehand pen tool (touch/stylus).
 *   onExporter: (fn) => void — receives an async () => dataUrlPng exporter so the
 *               parent can grab the learner's drawing for the AI to read.
 */
import { useState, useEffect, useCallback } from 'react';
import { Excalidraw, convertToExcalidrawElements, exportToBlob } from '@excalidraw/excalidraw';
import { parseMermaidToExcalidraw } from '@excalidraw/mermaid-to-excalidraw';

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = reject;
  r.readAsDataURL(blob);
});

export default function DrawCanvas({ payload, sketch = false, onExporter }) {
  const [api, setApi] = useState(null);

  const render = useCallback(async () => {
    if (!api || sketch || !payload) return;
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
  }, [api, payload, sketch]);

  useEffect(() => { render(); }, [render]);

  // In sketch mode, start on the freehand pen and hand the parent an exporter.
  useEffect(() => {
    if (!api) return;
    if (sketch) {
      try { api.setActiveTool({ type: 'freedraw' }); } catch { /* ok */ }
      onExporter?.(async () => {
        const blob = await exportToBlob({
          elements: api.getSceneElements(),
          appState: { ...api.getAppState(), exportBackground: true, viewBackgroundColor: '#ffffff' },
          files: api.getFiles(),
          mimeType: 'image/png',
        });
        return blobToDataUrl(blob);
      });
    }
  }, [api, sketch, onExporter]);

  return <Excalidraw excalidrawAPI={(a) => setApi(a)} />;
}
