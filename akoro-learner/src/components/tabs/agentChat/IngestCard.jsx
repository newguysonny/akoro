/**
 * IngestCard — a chat upload saved to the Library (Grand Plan §7.17, D51):
 * "Saved to Library › Biology — Past papers", how far the reading got, that
 * it is private, Open folder and Undo. After Undo: removed, with Save it
 * again while the file is still in this tab.
 */
import { useState } from 'react';
import { useLang } from '../../../contexts/LanguageContext.jsx';
import { Icon } from '../../common/Icons.jsx';
import Spinner from '../../common/Spinner.jsx';
import { BRAND, GREEN } from '../../../constants.js';

const btn = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 20, fontSize: 12, fontWeight: 800, fontFamily: "'Nunito',sans-serif", cursor: 'pointer', whiteSpace: 'nowrap' };
const dot = <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--ak-text-muted)', display: 'inline-block' }}/>;

export default function IngestCard({ ingest, onOpenFolder, onUndo, onRedo }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  if (!ingest) return null;
  const run = (fn) => async () => { if (busy || !fn) return; setBusy(true); try { await fn(); } finally { setBusy(false); } };

  if (ingest.state === 'undone') {
    return (
      <div data-ingest="undone" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: '9px 12px', borderRadius: 14, background: 'var(--ak-surface-hover)', border: '1px dashed var(--ak-border2)', fontSize: 12.5, fontWeight: 700, color: 'var(--ak-text-muted)', margin: '0 0 10px' }}>
        <Icon name="ti-folder-off" size={15}/>
        <span style={{ flex: 1, minWidth: 160 }}>{t('agent.filed_undone')}</span>
        {onRedo && (
          <button type="button" onClick={run(onRedo)} disabled={busy} style={{ ...btn, border: 'none', background: 'none', color: BRAND }}>
            {busy ? <Spinner size={11} color={BRAND}/> : null}{t('agent.filed_redo')}
          </button>
        )}
      </div>
    );
  }

  const reading = ['received', 'filed', 'extracting'].includes(ingest.state);
  const failed = ingest.state === 'failed';
  const folder = ingest.folder?.name;
  const n = ingest.reading?.total || ingest.pages || 0;
  const status = failed ? (
    <><Icon name="ti-alert-circle" size={12} color="#B45309"/> {t('agent.filed_failed')}</>
  ) : reading ? (
    <><Spinner size={10} color={BRAND}/> {ingest.state === 'received' ? t('agent.filed_saving')
      : n ? t('agent.filed_reading_n').replace('{done}', String(ingest.reading?.done ?? 0)).replace('{n}', String(n)) : t('agent.filed_reading')}</>
  ) : (
    <><Icon name="ti-check" size={12} color={GREEN}/> {t('agent.filed_read')}{n ? <>{dot}{t('agent.filed_pages').replace('{n}', String(n))}</> : null}
      {ingest.questions ? <>{dot}{t('agent.filed_questions').replace('{n}', String(ingest.questions))}</> : null}</>
  );

  return (
    <div data-ingest={ingest.state} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 14, background: 'var(--ak-surface-hover)', border: '1px solid var(--ak-border2)', margin: '0 0 10px' }}>
      <span style={{ width: 34, height: 34, borderRadius: 10, background: `${GREEN}1A`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon name="ti-folder-check" size={18} color={GREEN}/>
      </span>
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 900, color: 'var(--ak-text)' }}>
          {t('agent.filed_saved')}{folder ? <> › <span style={{ color: BRAND }}>{folder}</span></> : null}
        </p>
        <p style={{ margin: '2px 0 0', fontSize: 11.5, fontWeight: 600, color: 'var(--ak-text-muted)', display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          {status}{dot}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontWeight: 800, color: 'var(--ak-text-sub)' }}><Icon name="ti-lock" size={11}/> {t('agent.filed_private')}</span>
        </p>
      </div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0, marginLeft: 'auto' }}>
        {!reading && ingest.folder?.id && onOpenFolder && (
          <button type="button" onClick={() => onOpenFolder(ingest.folder.id)} style={{ ...btn, border: '1.5px solid var(--ak-border2)', background: 'var(--ak-surface)', color: 'var(--ak-text)' }}>
            <Icon name="ti-folder" size={13}/> {t('agent.filed_open')}
          </button>
        )}
        {ingest.state !== 'received' && onUndo && (
          <button type="button" onClick={run(onUndo)} disabled={busy} style={{ ...btn, border: 'none', background: 'none', color: 'var(--ak-text-muted)' }}>
            {busy ? <Spinner size={11} color="var(--ak-text-muted)"/> : null}{t('agent.filed_undo')}
          </button>
        )}
      </div>
    </div>
  );
}
