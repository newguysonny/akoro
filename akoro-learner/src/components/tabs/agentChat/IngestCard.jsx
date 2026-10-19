/**
 * IngestCard — one folder's worth of a chat upload (Grand Plan §7.17, D51).
 * A message's files are sorted per subject, one card each: "2 files ›
 * Biology — Past papers", the files, how far the reading got, private, Open
 * folder and Undo. The card also asks what the protégé can't decide — which
 * of two folders, which subject — says when reading moved the files, and
 * after Undo offers Restore for 30 days (Recently deleted).
 */
import { useState } from 'react';
import { useLang } from '../../../contexts/LanguageContext.jsx';
import { Icon } from '../../common/Icons.jsx';
import Spinner from '../../common/Spinner.jsx';
import { BRAND, GREEN } from '../../../constants.js';

const AMBER = '#D97706';
const UNSORTED = 'From chat — Unsorted';
const btn = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 20, fontSize: 12, fontWeight: 800, fontFamily: "'Nunito',sans-serif", cursor: 'pointer', whiteSpace: 'nowrap' };
const opt = { ...btn, padding: '6px 11px', border: '1.5px solid var(--ak-border2)', background: 'var(--ak-surface)', color: 'var(--ak-text)' };
const best = { ...opt, borderColor: `${BRAND}66`, color: BRAND, background: `${BRAND}0D` };
const dot = <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--ak-text-muted)', display: 'inline-block' }}/>;
const fileIcon = (name) => (/\.(png|jpe?g|webp|heic|gif)$/i.test(name || '') ? 'ti-photo' : /\.(mp3|m4a|wav|ogg|aac|flac)$/i.test(name || '') ? 'ti-music' : /\.(mp4|mov|webm|mkv|m4v)$/i.test(name || '') ? 'ti-video' : 'ti-file-text');
const shortName = (name) => String(name || '').replace(/\.(pdf|docx?|pptx?|txt|md|csv)$/i, '');

export default function IngestCard({ ingest, onOpenFolder, onUndo, onRestore, onChooseFolder, onChooseSubject, onReadAgain }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(null);
  const [other, setOther] = useState(null);   // "Other…" subject being typed
  if (!ingest) return null;
  const run = (key, fn) => async () => { if (busy || !fn) return; setBusy(key); try { await fn(); } finally { setBusy(null); } };
  const names = ingest.names || [];
  const count = names.length || 1;

  if (ingest.state === 'undone') {
    const canRestore = !!ingest.restorableUntil && !ingest.purged && onRestore;
    const what = count === 1 ? <b style={{ color: 'var(--ak-text-sub)' }}>{shortName(names[0])}</b> : t('agent.filed_n_files').replace('{n}', String(count));
    return (
      <div data-ingest="undone" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: '9px 12px', borderRadius: 14, background: 'var(--ak-surface-hover)', border: '1px dashed var(--ak-border2)', fontSize: 12.5, fontWeight: 700, color: 'var(--ak-text-muted)' }}>
        <Icon name="ti-trash" size={15}/>
        <span style={{ flex: 1, minWidth: 160 }}>
          {ingest.purged ? <>{what} {t('agent.filed_purged')}</> : <>{what} {t('agent.filed_deleted')}</>}
        </span>
        {canRestore && (
          <button type="button" data-action="restore" onClick={run('restore', onRestore)} disabled={!!busy} style={{ ...btn, border: 'none', background: 'none', color: BRAND }}>
            {busy === 'restore' ? <Spinner size={11} color={BRAND}/> : null}{t('agent.filed_restore')}
          </button>
        )}
      </div>
    );
  }

  const reading = ['received', 'filed', 'extracting'].includes(ingest.state);
  const failed = ingest.state === 'failed';
  const folder = ingest.folder?.name;
  const unsorted = folder === UNSORTED;
  const choices = ingest.choices || null;
  const asking = !reading && ingest.needsSubject && onChooseSubject;
  const moved = !!ingest.movedFrom && !!folder;
  const n = ingest.reading?.total || ingest.pages || 0;

  // Saved, but the read failed (the model was unavailable): it says so, never "Read".
  const unread = !failed && !reading && ingest.readFailed;
  const status = failed ? (
    <><Icon name="ti-alert-circle" size={12} color="#B45309"/> {t('agent.filed_failed')}</>
  ) : unread ? (
    <><Icon name="ti-alert-circle" size={12} color="#B45309"/> Saved · couldn't read it yet</>
  ) : reading ? (
    <><Spinner size={10} color={BRAND}/> {ingest.state === 'received' ? t('agent.filed_saving')
      : n ? t('agent.filed_reading_n').replace('{done}', String(ingest.reading?.done ?? 0)).replace('{n}', String(n)) : t('agent.filed_reading')}
      {unsorted ? <>{dot}{t('agent.filed_held_in')} <b style={{ color: 'var(--ak-text-sub)' }}>{UNSORTED}</b></> : null}</>
  ) : (
    <><Icon name="ti-check" size={12} color={GREEN}/> {t('agent.filed_read')}{n ? <>{dot}{t('agent.filed_pages').replace('{n}', String(n))}</> : null}
      {ingest.questions ? <>{dot}{t('agent.filed_questions').replace('{n}', String(ingest.questions))}</> : null}
      {moved ? <>{dot}{t('agent.filed_was_in')} <s>{ingest.movedFrom}</s></> : null}</>
  );

  const head = choices ? t('agent.filed_which_folder')
    : asking ? t('agent.filed_which_subject')
    : moved ? <>{t('agent.filed_moved_to')} › <span style={{ color: BRAND }}>{folder}</span></>
    : unsorted && reading ? <>{t('agent.filed_n_file' + (count === 1 ? '' : 's')).replace('{n}', String(count))} › <span style={{ color: BRAND }}>{t('agent.filed_sorting')}</span></>
    : folder ? <>{t('agent.filed_n_file' + (count === 1 ? '' : 's')).replace('{n}', String(count))} › <span style={{ color: BRAND }}>{folder}</span>
        {ingest.folder?.created && reading ? <span style={{ color: GREEN, fontSize: 11 }}> · {t('agent.filed_new_folder')}</span> : null}</>
    : t('agent.filed_saved');
  const icon = choices || asking ? ['ti-folder-question', AMBER] : moved ? ['ti-folder-share', BRAND] : unsorted && reading ? ['ti-folder-question', BRAND] : ['ti-folder-check', GREEN];

  return (
    <div data-ingest={ingest.state} data-filing={choices ? 'choose-folder' : asking ? 'choose-subject' : moved ? 'moved' : unsorted ? 'unsorted' : 'filed'}
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 14, background: moved ? `${BRAND}08` : 'var(--ak-surface-hover)', border: `1px solid ${moved ? `${BRAND}55` : 'var(--ak-border2)'}` }}>
      <span style={{ width: 34, height: 34, borderRadius: 10, background: `${icon[1]}1A`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon name={icon[0]} size={18} color={icon[1]}/>
      </span>
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 900, color: 'var(--ak-text)' }}>{head}</p>
        {names.length > 0 && (
          <p style={{ margin: '3px 0 0', display: 'flex', gap: 4, flexWrap: 'wrap', fontSize: 11, fontWeight: 700, color: 'var(--ak-text-sub)' }}>
            {names.map((nm, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', borderRadius: 8, padding: '1px 6px', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <Icon name={fileIcon(nm)} size={11}/> {shortName(nm)}
              </span>
            ))}
          </p>
        )}
        <p style={{ margin: '3px 0 0', fontSize: 11.5, fontWeight: 600, color: 'var(--ak-text-muted)', display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          {status}{dot}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontWeight: 800, color: 'var(--ak-text-sub)' }}><Icon name="ti-lock" size={11}/> {t('agent.filed_private_short')}</span>
        </p>
      </div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0, marginLeft: 'auto' }}>
        {!reading && !choices && !asking && ingest.folder?.id && onOpenFolder && (
          <button type="button" onClick={() => onOpenFolder(ingest.folder.id)} style={{ ...btn, border: '1.5px solid var(--ak-border2)', background: 'var(--ak-surface)', color: 'var(--ak-text)' }}>
            <Icon name="ti-folder" size={13}/> {t('agent.filed_open')}
          </button>
        )}
        {unread && onReadAgain && (
          <button type="button" data-action="read-again" onClick={run('read', onReadAgain)} disabled={!!busy} style={{ ...btn, border: '1.5px solid var(--ak-border2)', background: 'var(--ak-surface)', color: BRAND }}>
            {busy === 'read' ? <Spinner size={11} color={BRAND}/> : <Icon name="ti-refresh" size={13}/>} Read it again
          </button>
        )}
        {ingest.state !== 'received' && onUndo && (
          <button type="button" data-action="undo" onClick={run('undo', onUndo)} disabled={!!busy} style={{ ...btn, border: 'none', background: 'none', color: 'var(--ak-text-muted)' }}>
            {busy === 'undo' ? <Spinner size={11} color="var(--ak-text-muted)"/> : null}{t('agent.filed_undo')}
          </button>
        )}
      </div>

      {choices && onChooseFolder && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, width: '100%' }}>
          {choices.map((c, i) => (
            <button key={c.id} type="button" data-folder-choice={c.id} onClick={run(c.id, () => onChooseFolder(c.id))} disabled={!!busy} style={i === 0 ? best : opt}>
              {busy === c.id ? <Spinner size={11} color={BRAND}/> : <Icon name="ti-folder" size={12}/>} {c.name}
            </button>
          ))}
        </div>
      )}

      {asking && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, width: '100%' }}>
          {other === null ? (
            <>
              {(ingest.subjectOptions || []).map((s, i) => (
                <button key={s} type="button" data-subject-choice={s} onClick={run(s, () => onChooseSubject(s))} disabled={!!busy} style={i === 0 ? best : opt}>
                  {busy === s ? <Spinner size={11} color={BRAND}/> : null}{s}
                </button>
              ))}
              <button type="button" onClick={() => setOther('')} disabled={!!busy} style={opt}>{t('agent.filed_other')}</button>
              <button type="button" data-action="keep-unsorted" onClick={run('keep', () => onChooseSubject(null))} disabled={!!busy} style={{ ...btn, border: 'none', background: 'none', color: 'var(--ak-text-muted)' }}>
                {t('agent.filed_keep_unsorted')}
              </button>
            </>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); if (other.trim()) run('other', () => onChooseSubject(other.trim()))(); }} style={{ display: 'flex', gap: 6, flex: 1, minWidth: 200 }}>
              <input autoFocus value={other} onChange={(e) => setOther(e.target.value.slice(0, 50))} placeholder={t('agent.filed_subject_ph')}
                style={{ flex: 1, minWidth: 0, padding: '7px 11px', borderRadius: 20, border: '1.5px solid var(--ak-border2)', background: 'var(--ak-surface)', color: 'var(--ak-text)', fontSize: 12.5, fontFamily: 'inherit', fontWeight: 700 }}/>
              <button type="submit" disabled={!other.trim() || !!busy} style={{ ...btn, border: 'none', background: `linear-gradient(135deg,${BRAND},#4C1DCC)`, color: '#fff' }}>
                {busy === 'other' ? <Spinner size={11} color="#fff"/> : null}{t('agent.filed_file_it')}
              </button>
              <button type="button" onClick={() => setOther(null)} style={{ ...btn, border: 'none', background: 'none', color: 'var(--ak-text-muted)' }}>{t('common.cancel')}</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
