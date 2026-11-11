/**
 * ExtractionCard — the one "Extract text" / "Read as-is" sheet the reader
 * shows over a document: offer → running (progress) → applied / error.
 *
 * Shared by the Library record reader (RecordTeachSession) and the PHARM.D
 * topic reader so both spend the same GPU lane and say the same thing. The
 * Library also uses it for audio/video ("Transcribe"), hence the av copy.
 */
import { Icon } from '../common/Icons.jsx';
import { BRAND } from '../../constants.js';

const btnPrimary = { border: 'none', borderRadius: 100, padding: '11px 16px', fontSize: 12.5, fontWeight: 800,
  color: '#fff', background: `linear-gradient(135deg, ${BRAND}, #4C1DCC)`, cursor: 'pointer',
  fontFamily: "'Nunito',sans-serif" };
const btnGhost = { border: '1px solid var(--ak-border2, #E5E7EB)', borderRadius: 100, padding: '11px 16px',
  fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text-sub)', background: 'transparent',
  cursor: 'pointer', fontFamily: "'Nunito',sans-serif" };

export default function ExtractionCard({
  extract,              // { status:'offer'|'running'|'error'|'applied', done, total, error, av, elapsed }
  onExtract,            // start/replace the paid extraction
  onTranscribe = null,  // A/V: start the transcript instead
  onDismiss,            // close the card ("Read as-is" / "Dismiss")
  type = 'pdf',         // 'pdf' | 'image' | 'av'
}) {
  if (!extract) return null;
  const av = !!extract.av;
  const total = extract.total || 0;
  const pct = total > 0 ? Math.min(100, Math.round((extract.done / total) * 100)) : 0;

  return (
    <div role="dialog" aria-label="AI text extraction" style={{ position: 'fixed', inset: 0, zIndex: 3400,
      background: 'rgba(10,12,24,.55)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', padding: 20, fontFamily: "'Nunito',sans-serif" }}>
      <div style={{ width: 'min(400px, 100%)', background: 'var(--ak-surface)', borderRadius: 22,
        padding: '22px 20px 18px', border: '1px solid var(--ak-border2, #E5E7EB)',
        boxShadow: '0 18px 48px rgba(15,23,42,.28)' }}>
        {extract.status === 'running' ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span className="ti ti-loader-2" style={{ fontSize: 18, color: BRAND, animation: 'ecard-spin 1s linear infinite' }}/>
              <strong style={{ fontSize: 14.5, fontWeight: 900, color: 'var(--ak-text)' }}>Extracting the text…</strong>
            </div>
            <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ak-text-sub)', margin: '0 0 12px' }}>
              {av
                ? `Transcribing${extract.elapsed ? ` — ${extract.elapsed}s` : ''}. Long recordings take a minute or two; this stays open until it's done.`
                : total > 1 ? `Page ${Math.min(extract.done + 1, total)} of ${total}` : 'Reading the page'}
            </p>
            <div style={{ height: 8, borderRadius: 5, background: 'var(--ak-tag-bg, #EEF0F5)', overflow: 'hidden' }}>
              <div style={{ width: `${Math.max(6, pct)}%`, height: '100%', borderRadius: 5,
                background: `linear-gradient(90deg, ${BRAND}, #4C1DCC)`, transition: 'width .4s ease' }}/>
            </div>
          </>
        ) : extract.status === 'error' ? (
          <>
            <strong style={{ fontSize: 14.5, fontWeight: 900, color: 'var(--ak-text)' }}>Extraction didn't finish</strong>
            <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ak-text-sub)', margin: '8px 0 14px', lineHeight: 1.5 }}>
              {extract.error}{extract.done ? ` ${extract.done} page${extract.done === 1 ? '' : 's'} were saved — a retry only parses the rest.` : ''}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onExtract} style={btnPrimary}>Try again</button>
              <button onClick={onDismiss} style={btnGhost}>Read as-is</button>
            </div>
          </>
        ) : extract.status === 'applied' ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 34, height: 34, borderRadius: 12, background: 'rgba(16,185,129,.12)',
                border: '1px solid rgba(16,185,129,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="ti-check" size={18} color="#10B981"/>
              </span>
              <strong style={{ fontSize: 14.5, fontWeight: 900, color: 'var(--ak-text)' }}>Text extracted</strong>
            </div>
            <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ak-text-sub)', margin: '8px 0 0', lineHeight: 1.5 }}>
              {extract.done} page{extract.done === 1 ? '' : 's'} now read like a text document — the agent teaches from the real words.
              {extract.error ? ` (${extract.error})` : ''}
            </p>
            {extract.error && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button onClick={onExtract} style={btnPrimary}>Retry the missing pages</button>
                <button onClick={onDismiss} style={btnGhost}>Dismiss</button>
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{ width: 34, height: 34, borderRadius: 12, background: `${BRAND}15`,
                border: `1px solid ${BRAND}38`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="ti-sparkles" size={17} color={BRAND}/>
              </span>
              <strong style={{ fontSize: 14.5, fontWeight: 900, color: 'var(--ak-text)' }}>
                {av ? 'Transcribe this recording?' : type === 'image' ? 'Extract the text from this image?' : 'Read this PDF with AI?'}
              </strong>
            </div>
            <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ak-text-sub)', margin: '6px 0 14px', lineHeight: 1.55 }}>
              {av
                ? 'Turn the speech into a timestamped transcript (with speakers). The agent teaches from the real words, and every line jumps the player to that moment.'
                : 'The AI reads the page layout — tables, figures and reading order — and saves the markdown once for this file. The agent then teaches, quotes and cites from the real words, and citation jumps land on the exact paragraph. Drag-select keeps using the PDF text layer.'}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={av && onTranscribe ? onTranscribe : onExtract} style={btnPrimary}>{av ? 'Transcribe' : 'Extract text'}</button>
              <button onClick={onDismiss} style={btnGhost}>Read as-is</button>
            </div>
          </>
        )}
      </div>
      <style>{'@keyframes ecard-spin{to{transform:rotate(360deg)}}'}</style>
    </div>
  );
}
