/**
 * ReaderAsk — the reader's "Ask" tab: questions about THIS document,
 * answered from passages found anywhere in it, with numbered citation
 * chips that jump the reader to the page and flash the cited box (or seek
 * a recording to the moment).
 *
 * The reader stays generic: whoever opens it passes `ask`:
 *   ask.load()  → Promise<[{ id, role, text, citations, selection }]>
 *   ask.send({ question, selection, onDelta, onStatus, signal })
 *               → Promise<{ answer, citations }>
 * `pin` is a passage the learner chose with "Ask about this"
 * ({ pageNumber, text }); `onPinClear` drops it.
 *
 * `ask.suggestions` (optional) — questions grounded in THIS document
 * ({ label, citation?, icon? }), drawn from its key terms and topics by
 * the host (lib/learnSuggestions.js, the grounding the guide chat used).
 * They render in a collapsible dropdown, the guide chat's old pattern;
 * tapping one asks it. No suggestions → no dropdown.
 */
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../common/Icons.jsx';
import { answerBlocks, citeLabel, toReaderCite } from '../../lib/askAnswer.js';

function CiteChip({ cite, onCite }) {
  const target = toReaderCite(cite);
  return (
    <button
      type="button"
      onClick={() => target && onCite(target)}
      disabled={!target}
      title={cite.quote ? `“${cite.quote}”` : 'Source'}
      aria-label={`Source ${cite.n}: ${citeLabel(cite)}`}
      className="folio-citation"
      style={{ margin: '0 2px', verticalAlign: 'baseline', cursor: target ? 'pointer' : 'default' }}
    >
      <Icon name={Number.isFinite(cite.startMs) && !Number.isInteger(cite.pageNumber) ? 'ti-player-play' : 'ti-file-text'} size={10}/>
      {citeLabel(cite)}
    </button>
  );
}

function Pieces({ pieces, onCite }) {
  return pieces.map((p, i) => {
    if (p.type === 'bold') return <strong key={i}>{p.text}</strong>;
    if (p.type === 'cite') return <CiteChip key={i} cite={p.cite} onCite={onCite}/>;
    return <span key={i}>{p.text}</span>;
  });
}

/** Strip a model's <final>/reasoning sentinel so it never leaks into the bubble. */
function cleanAnswerText(text) {
  let s = String(text || '');
  const i = s.lastIndexOf('</final>');
  if (i !== -1) s = s.slice(i + '</final>'.length);   // keep the part after the last closing sentinel
  return s.replace(/<\/?final>/gi, '');
}

/** An answer with its [n] citations as chips that jump the reader (Ask, and the guide chat). */
export function Answer({ text, citations, onCite }) {
  const blocks = answerBlocks(cleanAnswerText(text), citations);
  return (
    <div className="text-sm leading-relaxed" style={{ color: 'var(--ak-text)' }}>
      {blocks.map((b, i) => {
        if (b.type === 'hr') return <hr key={i} style={{ border: 0, borderTop: '1px solid var(--ak-border2)', margin: '12px 0' }}/>;
        if (b.type === 'h') {
          const size = b.level <= 2 ? 15 : b.level === 3 ? 13.5 : 12.5;
          return (
            <p key={i} style={{ margin: i === 0 ? '0 0 6px' : '14px 0 6px', fontWeight: 800, fontSize: size, lineHeight: 1.35, color: 'var(--ak-text)' }}>
              <Pieces pieces={b.pieces} onCite={onCite}/>
            </p>
          );
        }
        if (b.type === 'p') return <p key={i} style={{ margin: '0 0 8px' }}><Pieces pieces={b.pieces} onCite={onCite}/></p>;
        const List = b.type === 'ol' ? 'ol' : 'ul';
        return (
          <List key={i} style={{ margin: '0 0 10px', paddingLeft: 20, listStyle: b.type === 'ol' ? 'decimal' : 'disc' }}>
            {b.items.map((it, j) => <li key={j} style={{ marginBottom: 4 }}><Pieces pieces={it} onCite={onCite}/></li>)}
          </List>
        );
      })}
    </div>
  );
}

export default function ReaderAsk({ ask, onCite, pin = null, onPinClear }) {
  const [messages, setMessages] = useState([]);
  const [loadState, setLoadState] = useState('loading');   // loading | ready | error
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [suggOpen, setSuggOpen] = useState(true);
  const abortRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    ask.load()
      .then((msgs) => { if (aliveRef.current) { setMessages(msgs || []); setLoadState('ready'); } })
      .catch(() => { if (aliveRef.current) setLoadState('error'); });
    return () => { aliveRef.current = false; abortRef.current?.abort(); };
  }, [ask]);

  useEffect(() => { if (pin) inputRef.current?.focus(); }, [pin]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  const send = async (text) => {
    const question = String(text ?? input).trim();
    if (!question || running) return;
    const selection = pin ? { ...(Number.isInteger(pin.pageNumber) ? { pageNumber: pin.pageNumber } : {}), text: pin.text } : null;
    const replyId = `a${Date.now()}`;
    setInput('');
    onPinClear?.();
    setMessages((m) => [...m,
      { id: `q${Date.now()}`, role: 'user', text: question, selection },
      { id: replyId, role: 'assistant', text: '', citations: [], pending: true },
    ]);
    setRunning(true);
    setStatus('Searching this document…');
    const controller = new AbortController();
    abortRef.current = controller;
    const patch = (fn) => { if (aliveRef.current) setMessages((m) => m.map((x) => (x.id === replyId ? fn(x) : x))); };
    try {
      const res = await ask.send({
        question, selection, signal: controller.signal,
        onStatus: (s) => { if (aliveRef.current && s?.label) setStatus(s.label); },
        onDelta: (d) => { if (aliveRef.current) setStatus(''); patch((x) => ({ ...x, text: x.text + d })); },
      });
      patch((x) => ({ ...x, text: res?.answer ?? x.text, citations: res?.citations || [], pending: false }));
    } catch (e) {
      const stopped = controller.signal.aborted;
      patch((x) => ({ ...x, pending: false, error: stopped ? null : (e?.message || 'Could not answer — try again.'), stopped }));
    } finally {
      if (aliveRef.current) { setRunning(false); setStatus(''); }
      abortRef.current = null;
    }
  };

  const suggItems = (ask.suggestions || [])
    .map((sg) => (typeof sg === 'string' ? { label: sg } : sg))
    .filter((sg) => sg?.label);

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <div className="flex flex-col h-full min-h-0" style={{ width: '100%', maxWidth: 760, margin: '0 auto' }}>
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto pr-1" aria-live="polite">
        <div className="mb-3">
          <div className="font-display text-base font-semibold" style={{ color: 'var(--ak-text)' }}>Ask this document</div>
          <div className="text-xs" style={{ color: 'var(--ak-text-sub)' }}>
            Answers come from the whole document, with sources you can tap to jump to.
          </div>
        </div>

        {loadState === 'loading' && <div className="text-xs" style={{ color: 'var(--ak-text-sub)' }}>Loading your questions…</div>}
        {loadState === 'error' && <div className="text-xs" style={{ color: 'var(--ak-danger-text)' }}>Couldn't load your earlier questions.</div>}

        {loadState !== 'loading' && messages.length === 0 && suggItems.length > 0 && (
          <div className="mb-3">
            <button type="button" onClick={() => setSuggOpen((o) => !o)} aria-expanded={suggOpen}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
                cursor: 'pointer', padding: 0, marginBottom: 10, fontSize: 10, fontWeight: 800,
                color: 'var(--ak-text-sub)', letterSpacing: .8, textTransform: 'uppercase',
                fontFamily: "'Nunito',sans-serif" }}>
              Suggestions from this document
              <span style={{ display: 'inline-flex', transform: suggOpen ? 'none' : 'rotate(-90deg)', transition: 'transform .18s' }}>
                <Icon name="ti-chevron-down" size={12}/>
              </span>
            </button>
            {suggOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {suggItems.map((sg, i) => (
                  <button key={sg.id || i} type="button" onClick={() => send(sg.label)} disabled={running}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                      padding: '10px 12px', borderRadius: 12, background: 'var(--ak-tag-bg)',
                      border: '1px solid var(--ak-border2)', cursor: 'pointer',
                      fontFamily: "'Nunito',sans-serif", color: 'var(--ak-text)' }}>
                    <Icon name={sg.icon || 'ti-bulb'} size={15}/>
                    <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700 }}>{sg.label}</span>
                    {sg.citation && toReaderCite(sg.citation) && (
                      <span role="button" tabIndex={0} className="folio-citation" aria-label={`Source: ${citeLabel(sg.citation)}`}
                        title={sg.citation.quote ? `“${sg.citation.quote}”` : 'Source'}
                        onClick={(e) => { e.stopPropagation(); onCite(toReaderCite(sg.citation)); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onCite(toReaderCite(sg.citation)); } }}
                        style={{ flexShrink: 0, cursor: 'pointer' }}>
                        <Icon name="ti-file-text" size={10}/> {citeLabel(sg.citation)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((m) => (m.role === 'user' ? (
          <div key={m.id} className="flex justify-end mb-3">
            <div className="rounded-2xl px-3 py-2 text-sm max-w-[85%]" style={{ background: 'var(--ak-tag-bg)', color: 'var(--ak-text)' }}>
              {m.selection?.text && (
                <div className="text-xs mb-1 pl-2" style={{ borderLeft: '2px solid var(--ak-border2)', color: 'var(--ak-text-sub)' }}>
                  {Number.isInteger(m.selection.pageNumber) ? `Page ${m.selection.pageNumber}: ` : ''}“{m.selection.text.slice(0, 140)}{m.selection.text.length > 140 ? '…' : ''}”
                </div>
              )}
              {m.text}
            </div>
          </div>
        ) : (
          <div key={m.id} className="mb-4">
            {m.text ? <Answer text={m.text} citations={m.citations || []} onCite={onCite}/> : null}
            {m.pending && !m.text && <div className="text-xs" style={{ color: 'var(--ak-text-sub)' }}>{status || 'Thinking…'}</div>}
            {m.error && <div className="text-xs" style={{ color: 'var(--ak-danger-text)' }}>{m.error}</div>}
            {m.stopped && <div className="text-xs" style={{ color: 'var(--ak-text-sub)' }}>Stopped.</div>}
          </div>
        )))}
      </div>

      <div className="flex-shrink-0 pt-2">
        {pin?.text && (
          <div className="flex items-start gap-2 mb-2 rounded-lg px-2.5 py-1.5 text-xs" style={{ background: 'var(--ak-tag-bg)', color: 'var(--ak-text-sub)' }}>
            <Icon name="ti-quote" size={12}/>
            <span className="flex-1 min-w-0">
              {Number.isInteger(pin.pageNumber) ? `Page ${pin.pageNumber}: ` : ''}“{pin.text.slice(0, 160)}{pin.text.length > 160 ? '…' : ''}”
            </span>
            <button type="button" onClick={onPinClear} aria-label="Remove the selected passage" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              <Icon name="ti-x" size={12}/>
            </button>
          </div>
        )}
        <div className="flex items-end gap-2 border rounded-2xl px-3 py-2" style={{ borderColor: 'var(--ak-border2)', background: 'var(--ak-surface)' }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={2000}
            placeholder={pin ? 'What do you want to know about this passage?' : 'Ask about this document…'}
            aria-label="Ask about this document"
            className="flex-1 resize-none bg-transparent outline-none text-sm"
            style={{ color: 'var(--ak-text)', maxHeight: 120 }}
          />
          {running ? (
            <button type="button" onClick={() => abortRef.current?.abort()} aria-label="Stop"
              className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'var(--ak-text)', color: 'var(--ak-bg)' }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: 'currentColor' }}/>
            </button>
          ) : (
            <button type="button" onClick={() => send()} disabled={!input.trim()} aria-label="Send question"
              className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: input.trim() ? 'var(--ak-accent)' : 'var(--ak-border2)', color: '#fff' }}>
              <Icon name="ti-arrow-up" size={15}/>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
