import { useEffect, useRef, useState } from 'react';
import { BRAND } from '../../constants.js';
import { Icon } from './Icons.jsx';

/*
 * The layout is adapted from akoro-learner/reference/FortizoApp.jsx's
 * ChatPanel composer: an input row with a compact, second-row tool rail.
 * The host owns every action. In particular, a model option is never sent as
 * an arbitrary model identifier: the host maps it to a supported API mode.
 */
function ComposerTool({ icon, label, onClick, disabled = false, active = false, dark = false, toggle = false }) {
  const unavailable = disabled || !onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={unavailable}
      title={label}
      aria-label={label}
      aria-disabled={unavailable}
      {...(toggle ? { 'aria-pressed': active } : {})}
      style={{
        width: 32, height: 32, padding: 0, borderRadius: '50%', border: 'none',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        color: active ? '#fff' : (dark ? '#C9D3E8' : '#526078'),
        background: active ? BRAND : (dark ? 'rgba(255,255,255,.08)' : '#fff'),
        cursor: unavailable ? 'not-allowed' : 'pointer',
        opacity: unavailable ? .48 : 1,
        transition: 'background .16s, color .16s, transform .16s',
      }}
      onMouseEnter={e => { if (!unavailable && !active) { e.currentTarget.style.background = BRAND; e.currentTarget.style.color = '#fff'; e.currentTarget.style.transform = 'translateY(-1px)'; } }}
      onMouseLeave={e => { if (!unavailable && !active) { e.currentTarget.style.background = dark ? 'rgba(255,255,255,.08)' : '#fff'; e.currentTarget.style.color = dark ? '#C9D3E8' : '#526078'; e.currentTarget.style.transform = 'none'; } }}
    >
      <Icon name={icon} size={16}/>
    </button>
  );
}

/**
 * ModelSwitch — the chat's model chip and its menu. Each option is
 * { id, label, description?, meta?, section?, disabled? }: `section` starts
 * a group heading, a `disabled` option (e.g. "Coming soon") is shown but
 * can't be picked. The host maps the id to its request. `up` opens the
 * menu above the chip (composer rails sit at the bottom of the screen).
 */
export function ModelSwitch({ modelId, modelLabel, modelOptions = [], onModelChange, disabled = false, dark = false, up = true, unavailableTitle = '', icon = 'ti-sparkles' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const closeOnOutsideClick = (event) => { if (!ref.current?.contains(event.target)) setOpen(false); };
    const closeOnEscape = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('mousedown', closeOnOutsideClick); document.removeEventListener('keydown', closeOnEscape); };
  }, []);
  const selectable = !disabled && modelOptions.length > 0 && typeof onModelChange === 'function';
  return (
    <div ref={ref} style={{ position: 'relative', marginLeft: 2, minWidth: 0 }}>
      <button
        type="button"
        onClick={() => selectable && setOpen((o) => !o)}
        disabled={!selectable}
        title={selectable ? 'Choose a model' : (unavailableTitle || modelLabel)}
        aria-label={selectable ? `Model: ${modelLabel}. Choose a model` : modelLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', gap: 5, maxWidth: 190, padding: '7px 10px',
          border: 'none', borderRadius: 17, cursor: selectable ? 'pointer' : 'default',
          color: dark ? '#D6DDED' : '#4B5871', background: dark ? 'rgba(255,255,255,.08)' : '#fff',
          fontSize: 11, fontWeight: 800, fontFamily: "'Nunito',sans-serif", whiteSpace: 'nowrap', overflow: 'hidden',
          opacity: selectable ? 1 : .78,
        }}
      >
        <Icon name={icon} size={13} color={BRAND}/>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{modelLabel}</span>
        {selectable && <Icon name="ti-chevron-down" size={12} color={dark ? '#AEB9D0' : '#8792A7'}/>}
      </button>

      {open && (
        <div role="menu" aria-label="Models" style={{
          position: 'absolute', zIndex: 20, ...(up ? { bottom: 42 } : { top: 40 }), left: 0, width: 270, padding: 5,
          maxHeight: 'min(70vh, 460px)', overflowY: 'auto',
          border: `1px solid ${dark ? 'rgba(255,255,255,.15)' : '#E2E5ED'}`, borderRadius: 13,
          color: dark ? '#E5EAFB' : 'var(--ak-text)', background: dark ? '#171827' : 'var(--ak-surface, #fff)',
          boxShadow: '0 13px 34px rgba(22,28,45,.24)',
        }}>
          {modelOptions.map((option) => {
            const selected = option.id === modelId;
            const off = !!option.disabled;
            return (
              <div key={option.id}>
              {option.section && (
                <div style={{ padding: '8px 9px 3px', fontSize: 9.5, fontWeight: 900, letterSpacing: '.07em', textTransform: 'uppercase', color: dark ? '#7F8BA3' : '#98A1B2', fontFamily: "'Nunito',sans-serif" }}>{option.section}</div>
              )}
              <button type="button" role="menuitemradio" aria-checked={selected} aria-disabled={off}
                title={off ? (option.note || 'Coming soon') : undefined}
                onClick={() => { if (off) return; onModelChange?.(option.id); setOpen(false); }} style={{
                  width: '100%', padding: '8px 9px', border: 'none', borderRadius: 9,
                  display: 'flex', alignItems: 'flex-start', gap: 7, textAlign: 'left', cursor: off ? 'not-allowed' : 'pointer',
                  color: selected ? BRAND : 'inherit', background: selected ? `${BRAND}14` : 'transparent',
                  opacity: off ? .55 : 1,
                  fontFamily: "'Nunito',sans-serif",
                }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: selected ? 900 : 800 }}>{option.label}</span>
                    {option.meta && (off
                      ? <span style={{ fontSize: 9, fontWeight: 900, color: '#B45309', background: 'rgba(245,158,11,.14)', borderRadius: 999, padding: '1px 7px', textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>{option.meta}</span>
                      : <span style={{ fontSize: 9.5, fontWeight: 800, color: dark ? '#9BA8C1' : '#8791A3', textTransform: 'uppercase', letterSpacing: '.04em' }}>{option.meta}</span>)}
                  </span>
                  {option.description && <span style={{ display: 'block', marginTop: 1, color: dark ? '#9BA8C1' : '#8791A3', fontSize: 10, fontWeight: 500, lineHeight: 1.35 }}>{option.description}</span>}
                </span>
                {selected && <Icon name="ti-check" size={14} color={BRAND}/>}
              </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Shared Fortizo-style composer for the learner's AI chat and adaptive
 * teaching session. Search is intentionally not included.
 */
export default function FortizoChatComposer({
  value,
  onChange,
  onSend,
  placeholder,
  disabled = false,
  dark = false,
  bookAction,
  boardAction,
  bookActive = false,
  bookLabel = 'Open reading material',
  voiceAction,
  voiceActive = false,
  voiceLabel = 'Start voice input',
  attachmentAction,
  attachmentLabel = 'Attach a file',
  attachmentUnavailable = false,
  audioAction,
  audioActive = false,
  audioLabel = 'Record an audio note',
  audioUnavailable = false,
  audioIcon = 'ti-wave-sine',   // a host can make this a switch (e.g. "always read aloud")
  audioToggle = false,
  modelLabel = 'Adaptive',
  modelId = modelLabel,
  modelOptions = [],
  onModelChange,
  modelLabelDescription = '',
  hideModelMenu = false,   // the host shows the model switch itself (AgentChatTab)
  sendDisabled = false,
  // While a reply is streaming the send arrow becomes a ■ stop button
  // (Agent Chat, Grand Plan §13.4). Callers without onStop are unchanged.
  running = false,
  onStop,
  stopLabel = 'Stop',
}) {
  const composerRef = useRef(null);
  const inputDisabled = disabled;
  const canSend = !disabled && !sendDisabled;

  const sendFromKeyboard = event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (canSend) onSend?.();
    }
  };

  const surface = dark ? 'rgba(255,255,255,.075)' : '#F8F9FC';
  const border = dark ? 'rgba(255,255,255,.13)' : '#DFE3ED';
  const inputColor = dark ? '#E5EAFB' : 'var(--ak-text)';

  return (
    <div ref={composerRef} style={{
      position: 'relative', padding: '12px 12px 11px', border: `1px solid ${border}`,
      borderRadius: 25, background: surface, boxShadow: dark ? 'none' : '0 4px 14px rgba(30,41,59,.055)',
      transition: 'border-color .16s, box-shadow .16s',
    }}>
      <input
        value={value}
        onChange={event => onChange?.(event.target.value)}
        onKeyDown={sendFromKeyboard}
        placeholder={placeholder}
        disabled={inputDisabled}
        aria-label={placeholder}
        onFocus={event => { event.currentTarget.parentElement.style.borderColor = BRAND; event.currentTarget.parentElement.style.boxShadow = `0 0 0 3px ${BRAND}1C`; }}
        onBlur={event => { event.currentTarget.parentElement.style.borderColor = border; event.currentTarget.parentElement.style.boxShadow = dark ? 'none' : '0 4px 14px rgba(30,41,59,.055)'; }}
        style={{
          display: 'block', width: '100%', height: 34, padding: '0 3px 8px', border: 0,
          outline: 'none', background: 'transparent', color: inputColor, fontSize: 13,
          fontWeight: 600, fontFamily: "'Nunito',sans-serif",
        }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        {/* Book control renders only when the host provides it — hosts without
            reading material (AI chat, decay sessions) keep the original rail. */}
        {bookAction && (
          <ComposerTool icon="ti-book-2" label={bookLabel} onClick={bookAction}
            disabled={disabled} active={bookActive} dark={dark}/>
        )}
        {/* Sketchpad control renders only when the host opens a whiteboard. */}
        {boardAction && (
          <ComposerTool icon="ti-edit" label="Whiteboard" onClick={boardAction}
            disabled={disabled} dark={dark}/>
        )}
        <ComposerTool icon="ti-microphone" label={voiceLabel} onClick={voiceAction}
          disabled={disabled || !voiceAction} active={voiceActive} dark={dark}/>
        <ComposerTool icon="ti-paperclip" label={attachmentLabel} onClick={attachmentAction}
          disabled={disabled || attachmentUnavailable || !attachmentAction} dark={dark}/>
        <ComposerTool icon={audioIcon} label={audioLabel} onClick={audioAction} toggle={audioToggle}
          disabled={(disabled && !audioToggle) || audioUnavailable || !audioAction} active={audioActive} dark={dark}/>

        {!hideModelMenu && (
          <ModelSwitch modelId={modelId} modelLabel={modelLabel} modelOptions={modelOptions}
            onModelChange={onModelChange} disabled={disabled} dark={dark}
            unavailableTitle={modelLabelDescription || 'The teaching session selects the response mode'}/>
        )}

        <div style={{ flex: 1 }}/>
        {running && onStop ? (
          <button
            type="button"
            onClick={() => onStop()}
            title={stopLabel}
            aria-label={stopLabel}
            style={{
              width: 33, height: 33, padding: 0, borderRadius: 10, display: 'inline-flex',
              alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer',
              border: dark ? '1px solid rgba(255,255,255,.18)' : '1.5px solid var(--ak-border2)',
              background: dark ? 'rgba(255,255,255,.08)' : 'var(--ak-surface)',
            }}
          >
            <span style={{ width: 11, height: 11, borderRadius: 2, background: dark ? '#fff' : 'var(--ak-text)', display: 'block' }}/>
          </button>
        ) : (
        <button
          type="button"
          onClick={() => canSend && onSend?.()}
          disabled={!canSend}
          title="Send message"
          aria-label="Send message"
          style={{
            width: 33, height: 33, padding: 0, border: 'none', borderRadius: 10, display: 'inline-flex',
            alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#fff',
            background: canSend ? BRAND : (dark ? 'rgba(255,255,255,.10)' : 'var(--ak-border2)'),
            boxShadow: canSend ? `0 5px 13px ${BRAND}42` : 'none', cursor: canSend ? 'pointer' : 'not-allowed',
            transition: 'background .16s, transform .16s',
          }}
        >
          <Icon name="ti-arrow-up" size={17} color={canSend ? '#fff' : (dark ? '#66758F' : 'var(--ak-text-muted)')}/>
        </button>
        )}
      </div>
    </div>
  );
}
