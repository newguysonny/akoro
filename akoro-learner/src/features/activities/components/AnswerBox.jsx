import { useRef, useState } from 'react';
import { Icon } from '../../../components/common/Icons.jsx';
import Spinner from '../../../components/common/Spinner.jsx';
import { BRAND, RED } from '../../../constants.js';
import { labelAnswerText, parseLabelAnswer, letterOf, readChoice } from '../../../lib/paper.js';
import { DOC_RE, DRAWING_RE, PER_QUESTION_FILES, isMcq } from './activityDetailModel.js';

/* A round tool button — the chat composer's look. */
function BoxTool({ icon, label, onClick, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={label} aria-label={label}
      style={{ width: 30, height: 30, padding: 0, borderRadius: '50%', border: '1px solid var(--ak-border)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#526078', background: 'var(--ak-surface)', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1 }}>
      <Icon name={icon} size={16}/>
    </button>
  );
}

/* A file in the answer box: type chip, name, and — while it goes up — a spinner (X cancels it); done, a tick (X removes it). */
function AnswerTile({ name, busy = false, uploading = false, onRemove, onOpen }) {
  const ext = (String(name || '').match(/\.([a-z0-9]+)$/i)?.[1] || 'file').toUpperCase().replace('JPEG', 'JPG').slice(0, 4);
  const doc = DOC_RE.test(name || '');
  const shown = doc ? 'Document' : DRAWING_RE.test(name || '') ? 'Drawing' : name;
  return (
    <div role="group" aria-label={`${shown}${uploading ? ' — uploading' : ''}`} data-testid={uploading ? 'upload-tile' : 'file-tile'}
      style={{ position: 'relative', width: 104, minHeight: 72, flexShrink: 0, boxSizing: 'border-box', padding: '6px 8px', borderRadius: 14, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', fontFamily: "'Nunito',sans-serif", opacity: busy ? 0.55 : 1 }}>
      <span style={{ display: 'inline-block', fontSize: 10.5, fontWeight: 900, letterSpacing: '.03em', padding: '1px 8px', borderRadius: 999, border: '1px solid var(--ak-border)', color: 'var(--ak-text)' }}>{doc ? 'DOCX' : ext}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} disabled={busy} aria-label={uploading ? `Cancel ${shown}` : `Remove ${shown}`}
          style={{ position: 'absolute', top: 5, right: 5, width: 20, height: 20, padding: 0, border: 'none', borderRadius: '50%', background: '#111', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <Icon name="ti-x" size={12}/>
        </button>
      )}
      <button type="button" onClick={onOpen} disabled={!onOpen || uploading}
        style={{ display: 'block', width: '100%', padding: 0, margin: '6px 0 0', border: 'none', background: 'none', textAlign: 'left', cursor: onOpen && !uploading ? 'pointer' : 'default', fontFamily: "'Nunito',sans-serif" }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ak-text)', lineHeight: 1.25, wordBreak: 'break-all', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', paddingRight: uploading ? 26 : 0 }}>{shown}</span>
      </button>
      <span style={{ position: 'absolute', right: 8, bottom: 7 }}>
        {uploading ? <Spinner size={20} color={BRAND}/> : <Icon name="ti-circle-check-filled" size={16} color="#10B981"/>}
      </span>
    </div>
  );
}

/* The answer box under the question — compact; for written answers it opens a document to type in. */
export default function AnswerBox({ format = 'all', q, idx, value, onType, files, pending = [], onCancelPending, onPick, onRemove, onOpenFile, onDraw, onWrite, uploading, removing, status, saveErr, onRetry, fileErr }) {
  const fileRef = useRef(null);
  const camRef = useRef(null);
  const [focus, setFocus] = useState(false);
  const full = files.length + pending.length >= PER_QUESTION_FILES;
  const mcq = isMcq(q);
  // How this assignment may be answered (details.answer_format; none = everything). Picking an option for a
  // multiple-choice question is always allowed; the API enforces the rest.
  const canType = format !== 'images' || mcq;
  const canImages = format !== 'text';
  const canDocs = format === 'all';
  const formatNote = mcq ? '' : { images: 'Photos only', text: 'Typed only', images_text: 'Typed or photos' }[format] || '';
  const labelling = q?.format === 'label' && Array.isArray(q.labels);
  const typed = typeof value === 'string' ? value.trim() : '';
  // A written answer (not a choice, gap or label) is typed in a document when the assignment takes documents.
  const inDoc = canDocs && !mcq && !labelling && q?.answer_space !== 'blank' && !typed;
  const hasDoc = files.some((f) => DOC_RE.test(f.name || ''));
  const pick = mcq && typed ? readChoice(q, typed) : null;
  const placeholder = q?.format === 'true_false' ? 'Type True or False'
    : mcq ? `Type the letter (${letterOf(0)}–${letterOf(q.options.length - 1)})` : 'Type your answer…';
  return (
    <div style={{ marginTop: 8, padding: '8px 10px 6px', border: `1px solid ${focus ? BRAND : 'var(--ak-border)'}`, boxShadow: focus ? `0 0 0 3px ${BRAND}1C` : '0 3px 10px rgba(30,41,59,.05)', borderRadius: 18, background: 'var(--ak-surface)', transition: 'border-color .16s, box-shadow .16s' }}>
      {(files.length > 0 || pending.length > 0) && (
        <div style={{ display: 'flex', gap: 8, margin: '0 0 8px', overflowX: 'auto', paddingBottom: 2 }}>
          {files.map((f) => <AnswerTile key={f.id} name={f.name} busy={removing === f.id} onOpen={onOpenFile ? () => onOpenFile(f) : undefined} onRemove={() => onRemove(f)}/>)}
          {pending.map((pf) => <AnswerTile key={pf.key} name={pf.name} uploading onRemove={() => onCancelPending?.(pf.key)}/>)}
        </div>
      )}
      {!canType ? (
        /* A photo-only assignment: the answer is a picture of the work, not typed words. */
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', margin: '0 0 8px', borderRadius: 14, background: 'var(--ak-bg)', border: '1px dashed var(--ak-border2)', fontFamily: "'Nunito',sans-serif" }}>
          <Icon name="ti-camera" size={20} color={BRAND}/>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ak-text-sec)', lineHeight: 1.45 }}>Take a photo of your answer{canImages ? ', or draw it on the whiteboard' : ''}. Up to {PER_QUESTION_FILES} photos.</span>
        </div>
      ) : labelling ? (
        /* Labelling: name each marked part of the diagram. */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
          {(() => {
            const vals = parseLabelAnswer(q.labels, value);
            return q.labels.map((l) => (
              <label key={l} style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: "'Nunito',sans-serif" }}>
                <span style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12.5, fontWeight: 900, color: BRAND, background: `${BRAND}12`, border: `1.5px solid ${BRAND}40` }}>{l}</span>
                <input value={vals[l]} maxLength={200} aria-label={`Part ${l}`} placeholder={`What is ${l}?`}
                  onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
                  onChange={(e) => onType(labelAnswerText(q.labels, { ...vals, [l]: e.target.value.replace(/\n/g, ' ') }) || '')}
                  style={{ flex: 1, minWidth: 0, borderRadius: 11, border: '1px solid var(--ak-border)', padding: '9px 11px', fontFamily: "'Nunito',sans-serif", fontSize: 14, fontWeight: 600, color: 'var(--ak-text)', outline: 'none', background: 'var(--ak-bg)' }}/>
              </label>
            ));
          })()}
        </div>
      ) : inDoc ? (
        /* A written answer is typed in a document: tapping the box opens it. */
        <button type="button" onClick={onWrite} disabled={uploading} data-testid="write-in-doc" aria-label={`Write the answer to question ${idx + 1} in a document`}
          style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '9px 4px', margin: '0 0 4px', border: 'none', background: 'transparent', color: 'var(--ak-text-muted)', cursor: uploading ? 'default' : 'text', textAlign: 'left', fontSize: 14, fontWeight: 600, fontFamily: "'Nunito',sans-serif" }}>
          <Icon name="ti-file-type-docx" size={18} color="#2B579A"/>
          <span>{hasDoc ? 'Tap to keep writing in your document…' : 'Tap to write your answer in a document…'}</span>
        </button>
      ) : (
        <textarea value={value ?? ''} onChange={(e) => onType(e.target.value)} aria-label={`Answer to question ${idx + 1}`}
          onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
          placeholder={placeholder} maxLength={4000} rows={mcq ? 1 : 2}
          style={{ display: 'block', width: '100%', minHeight: mcq ? 30 : 50, padding: '2px 3px 4px', border: 0, outline: 'none', resize: 'none', background: 'transparent', color: 'var(--ak-text)', fontSize: 14, lineHeight: 1.5, fontWeight: 600, fontFamily: "'Nunito',sans-serif", boxSizing: 'border-box' }}/>
      )}
      {canType && mcq && typed && (
        <div style={{ fontSize: 11.5, fontWeight: 800, margin: '0 3px 8px', color: pick != null ? '#047857' : '#B45309', fontFamily: "'Nunito',sans-serif" }}>
          {pick != null ? `Read as ${letterOf(pick)} · ${q.options[pick]}` : 'Not one of the options — your teacher will read it. Type a letter to be marked straight away.'}
        </div>
      )}
      <input ref={fileRef} type="file" multiple style={{ display: 'none' }} accept={canDocs ? '.pdf,.jpg,.jpeg,.png,.docx,.txt' : '.jpg,.jpeg,.png'}
        onChange={(e) => { onPick(e.target.files); e.target.value = ''; }}/>
      <input ref={camRef} type="file" accept="image/*" capture="environment" data-testid="camera-input" style={{ display: 'none' }}
        onChange={(e) => { onPick(e.target.files); e.target.value = ''; }}/>
      {canImages && files.length > 0 && !full && (
        <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ak-text-muted)', margin: '0 3px 6px', fontFamily: "'Nunito',sans-serif" }}>
          Answer carries on to another page? Add another photo.
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        {canImages && <BoxTool icon="ti-camera" label={full ? 'Up to 3 photos per question' : 'Take a photo of your answer'} onClick={() => camRef.current?.click()} disabled={full}/>}
        {canImages && canDocs && <BoxTool icon="ti-photo" label="Choose from gallery or files" onClick={() => fileRef.current?.click()} disabled={full}/>}
        {canImages && !canDocs && <BoxTool icon="ti-photo" label="Choose a photo from your gallery" onClick={() => fileRef.current?.click()} disabled={full}/>}
        {canImages && <BoxTool icon="ti-pencil" label="Draw it on the whiteboard" onClick={onDraw} disabled={uploading}/>}
        {canDocs && <BoxTool icon="ti-file-type-docx" label="Write it in a document (like Word)" onClick={onWrite} disabled={uploading}/>}
        {formatNote && <span style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--ak-text-muted)', fontFamily: "'Nunito',sans-serif" }}>{formatNote}</span>}
        {files.length > 0 && <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--ak-text-muted)', fontFamily: "'Nunito',sans-serif" }}>{files.length + pending.length}/{PER_QUESTION_FILES}</span>}
        <span style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 800, fontFamily: "'Nunito',sans-serif", display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          {saveErr ? (
            <button type="button" onClick={onRetry} style={{ border: 'none', background: 'none', padding: 0, color: RED, fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: "'Nunito',sans-serif" }}>Not saved · Retry</button>
          ) : status === 'edited' ? (
            <span style={{ color: 'var(--ak-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Spinner size={10}/> Saving…</span>
          ) : status === 'saved' ? (
            <span style={{ color: '#047857', display: 'inline-flex', alignItems: 'center', gap: 4 }}>Saved <Icon name="ti-check" size={13}/></span>
          ) : null}
        </span>
      </div>
      {fileErr && <div style={{ fontSize: 11.5, fontWeight: 700, color: RED, margin: '8px 3px 0', fontFamily: "'Nunito',sans-serif" }}>{fileErr}</div>}
    </div>
  );
}
