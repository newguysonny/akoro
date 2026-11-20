/**
 * ChatFilesStrip — "Files in this chat" (Grand Plan §7.17): the files this
 * conversation brought into the Library, each with its subject; a tap opens it
 * in the reader. The files live in their subject folders — this only lists
 * what this chat added. Deleted ones drop off.
 */
import { useLang } from '../../../contexts/LanguageContext.jsx';
import { Icon } from '../../../components/common/Icons.jsx';
import { BRAND } from '../../../constants.js';

const AMBER = '#D97706';
const shortName = (name) => String(name || '').replace(/\.(pdf|docx?|pptx?|txt|md|csv|jpe?g|png|webp|heic)$/i, '');
const iconFor = (f) => (/^image\//.test(f.mime || '') || /\.(png|jpe?g|webp|heic)$/i.test(f.name || '') ? 'ti-photo' : 'ti-file-text');

export default function ChatFilesStrip({ files = [], onOpen, gutter = 16 }) {
  const { t } = useLang();
  if (!files.length) return null;
  return (
    <div data-chat-files="" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, margin: `10px ${gutter}px 0`, padding: '8px 12px', borderRadius: 14, background: 'var(--ak-surface)', border: '1px solid var(--ak-border2)', flexShrink: 0, minWidth: 0 }}>
      <span style={{ fontSize: 11, fontWeight: 900, color: 'var(--ak-text-sub)', whiteSpace: 'nowrap', display: 'flex', gap: 5, alignItems: 'center' }}>
        <Icon name="ti-paperclip" size={12}/> {t('agent.chat_files')} · {files.length}
      </span>
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', flex: '1 1 220px', minWidth: 0, scrollbarWidth: 'none' }}>
        {files.map((f) => (
          <button key={f.recordId} type="button" data-chat-file={f.recordId} onClick={() => onOpen?.(f)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', fontSize: 11.5, fontWeight: 800, padding: '5px 10px', borderRadius: 20, background: 'var(--ak-surface-hover)', border: '1px solid var(--ak-border)', color: 'var(--ak-text)', cursor: 'pointer', fontFamily: "'Nunito',sans-serif" }}>
            <Icon name={iconFor(f)} size={12} color={f.subject ? BRAND : AMBER}/> {shortName(f.name)}
            <small style={{ color: 'var(--ak-text-muted)', fontWeight: 700 }}>{f.subject || t('agent.filed_unsorted')}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
