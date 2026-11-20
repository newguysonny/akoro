import { Icon } from '../../../components/common/Icons.jsx';
import Spinner from '../../../components/common/Spinner.jsx';
import useWordEditor from '../hooks/useWordEditor.js';
import { WORD_BLUE, LINE, TXT, SUB, UI_FONT, EDITOR_CSS } from './wordEditorTokens.js';
import { MenuItem } from './wordEditorParts.jsx';
import WordEditorToolbar from './WordEditorToolbar.jsx';
import WordEditorPage from './WordEditorPage.jsx';
import WordEditorStatusBar from './WordEditorStatusBar.jsx';

/*
 * WordEditor — a document editor laid out like Microsoft Word, opened from an
 * assignment's answer box. The point is familiarity: many learners have no
 * laptop at home, so this is where they meet the ribbon, the page, the ruler
 * and the status bar they'll use at school and at work.
 *
 *   ┌ [doc] document-q3.docx · Saved to your answer          [Save to answer] [x] ┐
 *   │ File  Home  Insert  Layout  View  (Table) (Picture)                          │
 *   │ [Undo|Clipboard|Font|Paragraph|Styles|Editing]   ← the ribbon, by tab       │
 *   │ ruler                                                                        │
 *   │            ┌──── white page (A4 / Letter, margins) ────┐                    │
 *   │            │                                            │                    │
 *   │ Page 1 of 2 · 312 words · 1,804 characters     [print][mobile]  − 100% +     │
 *
 * "Save to answer" writes a real Word file (lib/wordDoc.js) and hands it to
 * the page, which attaches it to the question. Phones start in Mobile view
 * (the text reflows to the screen, as in Word's phone app); Print layout
 * shows the real page.
 */
export default function WordEditor({ fileName = 'document.docx', subtitle = '', initial = {}, dirty: startDirty = false, onSave, onDraft, onClose, onDownload }) {
  const wd = useWordEditor({ fileName, subtitle, initial, dirty: startDirty, onSave, onDraft, onClose, onDownload });
  const { editor, saving, dirty, save, close, menu, setMenu, clip, inTable, c, setTab, setLinkUrl, setOpen, asking, setAsking } = wd;

  if (!editor) return null;

  return (
    <div role="dialog" aria-label={`Document editor — ${fileName}`}
      style={{ position: 'fixed', inset: 0, zIndex: 3500, display: 'flex', flexDirection: 'column', background: '#E6E6E6', fontFamily: UI_FONT }}>
      <style>{EDITOR_CSS}</style>

      {/* Title bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 'calc(env(safe-area-inset-top, 0px) + 6px) 10px 6px', background: WORD_BLUE, color: '#fff', flexShrink: 0 }}>
        <Icon name="ti-file-type-docx" size={20} color="#fff"/>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileName}</div>
          <div style={{ fontSize: 10.5, opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {saving ? 'Saving…' : dirty ? 'Not saved to your answer yet' : 'Saved to your answer'}{subtitle ? ` · ${subtitle}` : ''}
          </div>
        </div>
        <button type="button" onClick={save} disabled={saving || !dirty}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px', borderRadius: 3, border: '1px solid rgba(255,255,255,.55)', background: dirty ? '#fff' : 'transparent', color: dirty ? WORD_BLUE : '#fff', fontSize: 12.5, fontWeight: 600, cursor: saving || !dirty ? 'default' : 'pointer', fontFamily: UI_FONT, flexShrink: 0 }}>
          {saving ? <Spinner size={12}/> : <Icon name="ti-device-floppy" size={15}/>} <span>{dirty ? 'Save to answer' : 'Saved'}</span>
        </button>
        <button type="button" onClick={close} aria-label="Close the document"
          style={{ width: 32, height: 30, border: 'none', background: 'transparent', color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 3, flexShrink: 0 }}>
          <Icon name="ti-x" size={18}/>
        </button>
      </div>

      <WordEditorToolbar wd={wd}/>

      <WordEditorPage wd={wd}/>

      <WordEditorStatusBar wd={wd}/>

      {/* Right-click menu */}
      {menu && (
        <div onMouseDown={(e) => e.preventDefault()} style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 3800, width: 210, background: '#fff', border: `1px solid ${LINE}`, boxShadow: '0 6px 18px rgba(0,0,0,.18)', borderRadius: 4, padding: 4 }}>
          <MenuItem icon="ti-scissors" label="Cut" onClick={() => clip('cut')}/>
          <MenuItem icon="ti-copy" label="Copy" onClick={() => clip('copy')}/>
          <MenuItem icon="ti-clipboard" label="Paste" onClick={() => clip('paste')}/>
          <div style={{ height: 1, background: LINE, margin: '4px 0' }}/>
          {inTable ? (
            <>
              <MenuItem icon="ti-row-insert-bottom" label="Insert row below" onClick={() => { c().addRowAfter().run(); setMenu(null); }}/>
              <MenuItem icon="ti-column-insert-right" label="Insert column right" onClick={() => { c().addColumnAfter().run(); setMenu(null); }}/>
              <MenuItem icon="ti-row-remove" label="Delete row" onClick={() => { c().deleteRow().run(); setMenu(null); }}/>
              <MenuItem icon="ti-column-remove" label="Delete column" onClick={() => { c().deleteColumn().run(); setMenu(null); }}/>
              <MenuItem icon="ti-table-off" label="Delete table" onClick={() => { c().deleteTable().run(); setMenu(null); }}/>
            </>
          ) : (
            <>
              <MenuItem icon="ti-link" label="Link…" onClick={() => { setMenu(null); setTab('insert'); setLinkUrl(editor.getAttributes('link').href || ''); setTimeout(() => setOpen('link'), 0); }}/>
              <MenuItem icon="ti-clear-formatting" label="Clear formatting" onClick={() => { c().unsetAllMarks().run(); setMenu(null); }}/>
            </>
          )}
          <div style={{ height: 1, background: LINE, margin: '4px 0' }}/>
          <MenuItem icon="ti-select-all" label="Select all" onClick={() => { c().selectAll().run(); setMenu(null); }}/>
        </div>
      )}

      {/* Save before closing? */}
      {asking && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3900, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div role="alertdialog" aria-label="Save changes" style={{ width: '100%', maxWidth: 380, background: '#fff', borderRadius: 4, boxShadow: '0 12px 32px rgba(0,0,0,.3)', padding: '18px 20px', fontFamily: UI_FONT }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: TXT, marginBottom: 6 }}>Save changes to {fileName}?</div>
            <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.5, marginBottom: 16 }}>If you don't save, your answer keeps the last saved copy. Your changes stay on this device.</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" disabled={saving} onClick={async () => { if (await save()) { setAsking(false); onClose(); } else setAsking(false); }}
                style={{ height: 32, padding: '0 16px', border: 'none', borderRadius: 2, background: WORD_BLUE, color: '#fff', fontSize: 12.5, cursor: 'pointer' }}>{saving ? 'Saving…' : 'Save'}</button>
              <button type="button" onClick={() => { setAsking(false); onClose(); }} style={{ height: 32, padding: '0 16px', border: '1px solid #C8C8C8', borderRadius: 2, background: '#fff', fontSize: 12.5, cursor: 'pointer' }}>Don't Save</button>
              <button type="button" onClick={() => setAsking(false)} style={{ height: 32, padding: '0 16px', border: '1px solid #C8C8C8', borderRadius: 2, background: '#fff', fontSize: 12.5, cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
