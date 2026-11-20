import { EditorContent } from '@tiptap/react';
import { Ruler } from './wordEditorParts.jsx';
import { UI_FONT } from './wordEditorTokens.js';

export default function WordEditorPage({ wd }) {
  const { view, ruler, box, zoom, canvasRef, setMenu, editor, pages } = wd;

  return (
    <>
      {view === 'print' && ruler && <Ruler box={box} zoom={zoom}/>}

      {/* The page */}
      <div ref={canvasRef} onContextMenu={(e) => { e.preventDefault(); setMenu({ x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 300) }); }}
        onMouseDown={(e) => { if (e.target === e.currentTarget) editor.commands.focus('end'); }}
        style={{ flex: 1, overflow: 'auto', padding: view === 'print' ? '20px 20px 40px' : 0, background: view === 'print' ? '#E6E6E6' : '#fff' }}>
        {view === 'print' ? (
          <div style={{ zoom: zoom / 100, width: box.width, margin: '0 auto' }}>
            <div onMouseDown={(e) => { if (e.target === e.currentTarget) editor.commands.focus('end'); }}
              style={{ position: 'relative', background: '#fff', boxShadow: '0 0 0 1px #D0D0D0, 0 2px 8px rgba(0,0,0,.12)', boxSizing: 'border-box', width: box.width,
                minHeight: box.height * pages - (pages > 1 ? 0 : 0), padding: `${box.top}px ${box.right}px ${box.bottom}px ${box.left}px` }}>
              {/* where each page ends — the text keeps flowing, the line shows the break */}
              {Array.from({ length: pages - 1 }, (_, k) => (
                <div key={k} aria-hidden style={{ position: 'absolute', left: 0, right: 0, top: box.top + (k + 1) * box.contentHeight, borderTop: '1px dashed #C8C8C8', pointerEvents: 'none' }}>
                  <span style={{ position: 'absolute', right: 8, top: 2, fontSize: 10, color: '#A0A0A0', fontFamily: UI_FONT }}>Page {k + 2}</span>
                </div>
              ))}
              <EditorContent editor={editor}/>
            </div>
          </div>
        ) : (
          <div style={{ maxWidth: 760, margin: '0 auto', padding: '18px 16px 60px', boxSizing: 'border-box' }}>
            <EditorContent editor={editor}/>
          </div>
        )}
      </div>
    </>
  );
}
