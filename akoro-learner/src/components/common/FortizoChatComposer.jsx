import { useEffect, useRef, useState } from 'react';
import { BRAND } from '../../constants.js';
import { Icon } from './Icons.jsx';

/*
 * The layout is adapted from akoro-learner/reference/FortizoApp.jsx's
 * ChatPanel composer: an input row with a compact, second-row tool rail.
 * The host owns every action. In particular, a model option is never sent as
 * an arbitrary model identifier: the host maps it to a supported API mode.
 */
function ComposerTool({ icon, label, onClick, disabled = false, active = false, dark = false }) {
  const unavailable = disabled || !onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={unavailable}
      title={label}
      aria-label={label}
      aria-disabled={unavailable}
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
  modelLabel = 'Adaptive',
  modelId = modelLabel,
  modelOptions = [],
  onModelChange,
  modelLabelDescription = '',
  sendDisabled = false,
  // While a reply is streaming the send arrow becomes a ■ stop button
  // (Agent Chat, Grand Plan §13.4). Callers without onStop are unchanged.
  running = false,
  onStop,
  stopLabel = 'Stop',
}) {
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const composerRef = useRef(null);
  const inputDisabled = disabled;
  const canSend = !disabled && !sendDisabled;
  const hasSelectableModels = !disabled && modelOptions.length > 0 && typeof onModelChange === 'function';

  useEffect(() => {
    const closeOnOutsideClick = event => {
      if (!composerRef.current?.contains(event.target)) setModelMenuOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, []);

  const sendFromKeyboard = event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (canSend) onSend?.();
    }
  };

  const selectModel = option => {
    onModelChange?.(option.id);
    setModelMenuOpen(false);
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
        <ComposerTool icon="ti-wave-sine" label={audioLabel} onClick={audioAction}
          disabled={disabled || audioUnavailable || !audioAction} active={audioActive} dark={dark}/>

        <div style={{ position: 'relative', marginLeft: 2, minWidth: 0 }}>
          <button
            type="button"
            onClick={() => hasSelectableModels && setModelMenuOpen(open => !open)}
            disabled={!hasSelectableModels}
            title={hasSelectableModels ? 'Choose a supported chat mode' : (modelLabelDescription || 'The teaching session selects the response mode')}
            aria-label={hasSelectableModels ? 'Choose a supported chat mode' : modelLabel}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, maxWidth: 136, padding: '7px 9px',
              border: 'none', borderRadius: 17, cursor: hasSelectableModels ? 'pointer' : 'default',
              color: dark ? '#D6DDED' : '#4B5871', background: dark ? 'rgba(255,255,255,.08)' : '#fff',
              fontSize: 10.5, fontWeight: 800, fontFamily: "'Nunito',sans-serif", whiteSpace: 'nowrap', overflow: 'hidden',
              opacity: hasSelectableModels ? 1 : .78,
            }}
          >
            <Icon name="ti-sparkles" size={13} color={BRAND}/>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{modelLabel}</span>
            {hasSelectableModels && <Icon name="ti-chevron-down" size={12} color={dark ? '#AEB9D0' : '#8792A7'}/>}
          </button>

          {modelMenuOpen && (
            <div role="menu" aria-label="Supported chat modes" style={{
              position: 'absolute', zIndex: 20, bottom: 42, left: 0, width: 205, padding: 5,
              border: `1px solid ${dark ? 'rgba(255,255,255,.15)' : '#E2E5ED'}`, borderRadius: 13,
              color: dark ? '#E5EAFB' : 'var(--ak-text)', background: dark ? '#171827' : '#fff',
              boxShadow: '0 13px 34px rgba(22,28,45,.24)',
            }}>
              {modelOptions.map(option => {
                const selected = option.id === modelId;
                return (
                  <button key={option.id} type="button" role="menuitem" onClick={() => selectModel(option)} style={{
                    width: '100%', padding: '8px 9px', border: 'none', borderRadius: 9,
                    display: 'flex', alignItems: 'flex-start', gap: 7, textAlign: 'left', cursor: 'pointer',
                    color: selected ? BRAND : 'inherit', background: selected ? `${BRAND}14` : 'transparent',
                    fontFamily: "'Nunito',sans-serif",
                  }}>
                    <span style={{ flex: 1 }}>
                      <span style={{ display: 'block', fontSize: 11.5, fontWeight: selected ? 800 : 700 }}>{option.label}</span>
                      {option.description && <span style={{ display: 'block', marginTop: 1, color: dark ? '#9BA8C1' : '#8791A3', fontSize: 9.5, fontWeight: 500, lineHeight: 1.35 }}>{option.description}</span>}
                    </span>
                    {selected && <Icon name="ti-check" size={14} color={BRAND}/>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

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
