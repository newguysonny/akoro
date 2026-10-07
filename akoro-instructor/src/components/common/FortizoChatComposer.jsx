/**
 * FortizoChatComposer — the instructor console's copy of the learner app's
 * shared composer (akoro-learner/src/components/common/FortizoChatComposer.jsx).
 * Same layout and behaviour — compact input row over a second-row tool rail —
 * adapted to this app's system: lucide icons, DM Sans, the amber brand.
 *
 * The host owns every action. A model option is never sent as an arbitrary
 * model identifier: the host maps it to a supported API mode. `taskAction`
 * (instructor-only) follows the component's own pattern: a tool renders only
 * when the host provides it.
 */
import { useEffect, useRef, useState } from 'react';
import { Mic, Paperclip, ArrowUp, Sparkles, ChevronDown, Check, CheckSquare, AudioLines } from 'lucide-react';
import { AMBER, INK, BORDER, FONT } from '../../constants.js';

const SURFACE = '#F8F9FC';
const RAIL_BORDER = '#DFE3ED';
const MUTED_RAIL = '#526078';

function ComposerTool({ icon: Icon, label, onClick, disabled = false, active = false }) {
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
        color: active ? '#fff' : MUTED_RAIL,
        background: active ? AMBER : '#fff',
        cursor: unavailable ? 'not-allowed' : 'pointer',
        opacity: unavailable ? .48 : 1,
        transition: 'background .16s, color .16s, transform .16s',
      }}
      onMouseEnter={e => { if (!unavailable && !active) { e.currentTarget.style.background = AMBER; e.currentTarget.style.color = '#fff'; e.currentTarget.style.transform = 'translateY(-1px)'; } }}
      onMouseLeave={e => { if (!unavailable && !active) { e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = MUTED_RAIL; e.currentTarget.style.transform = 'none'; } }}
    >
      <Icon size={16} />
    </button>
  );
}

export default function FortizoChatComposer({
  value,
  onChange,
  onSend,
  placeholder,
  disabled = false,
  inputRef,
  taskAction,
  taskActive = false,
  taskLabel = 'Mark as task',
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
  modelLabel = 'Standard',
  modelId = modelLabel,
  modelOptions = [],
  onModelChange,
  modelLabelDescription = '',
  sendDisabled = false,
}) {
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const composerRef = useRef(null);
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

  return (
    <div ref={composerRef} style={{
      position: 'relative', padding: '12px 12px 11px', border: `1px solid ${RAIL_BORDER}`,
      borderRadius: 25, background: SURFACE, boxShadow: '0 4px 14px rgba(30,41,59,.055)',
      transition: 'border-color .16s, box-shadow .16s',
    }}>
      <input
        ref={inputRef}
        value={value}
        onChange={event => onChange?.(event.target.value)}
        onKeyDown={sendFromKeyboard}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={placeholder}
        onFocus={event => { event.currentTarget.parentElement.style.borderColor = AMBER; event.currentTarget.parentElement.style.boxShadow = `0 0 0 3px ${AMBER}1C`; }}
        onBlur={event => { event.currentTarget.parentElement.style.borderColor = RAIL_BORDER; event.currentTarget.parentElement.style.boxShadow = '0 4px 14px rgba(30,41,59,.055)'; }}
        style={{
          display: 'block', width: '100%', height: 34, padding: '0 3px 8px', border: 0,
          outline: 'none', background: 'transparent', color: INK, fontSize: 13,
          fontWeight: 600, fontFamily: FONT,
        }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        {/* Task toggle renders only when the host provides it (instructor). */}
        {taskAction && (
          <ComposerTool icon={CheckSquare} label={taskLabel} onClick={taskAction} active={taskActive} />
        )}
        <ComposerTool icon={Mic} label={voiceLabel} onClick={voiceAction}
          disabled={disabled || !voiceAction} active={voiceActive} />
        <ComposerTool icon={Paperclip} label={attachmentLabel} onClick={attachmentAction}
          disabled={disabled || attachmentUnavailable || !attachmentAction} />
        <ComposerTool icon={AudioLines} label={audioLabel} onClick={audioAction}
          disabled={disabled || audioUnavailable || !audioAction} active={audioActive} />

        <div style={{ position: 'relative', marginLeft: 2, minWidth: 0 }}>
          <button
            type="button"
            onClick={() => hasSelectableModels && setModelMenuOpen(open => !open)}
            disabled={!hasSelectableModels}
            title={hasSelectableModels ? 'Choose a supported chat mode' : (modelLabelDescription || modelLabel)}
            aria-label={hasSelectableModels ? 'Choose a supported chat mode' : modelLabel}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, maxWidth: 136, padding: '7px 9px',
              border: 'none', borderRadius: 17, cursor: hasSelectableModels ? 'pointer' : 'default',
              color: '#4B5871', background: '#fff',
              fontSize: 10.5, fontWeight: 800, fontFamily: FONT, whiteSpace: 'nowrap', overflow: 'hidden',
              opacity: hasSelectableModels ? 1 : .78,
            }}
          >
            <Sparkles size={13} color={AMBER} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{modelLabel}</span>
            {hasSelectableModels && <ChevronDown size={12} color="#8792A7" />}
          </button>

          {modelMenuOpen && (
            <div role="menu" aria-label="Supported chat modes" style={{
              position: 'absolute', zIndex: 20, bottom: 42, left: 0, width: 205, padding: 5,
              border: '1px solid #E2E5ED', borderRadius: 13,
              color: INK, background: '#fff',
              boxShadow: '0 13px 34px rgba(22,28,45,.24)',
            }}>
              {modelOptions.map(option => {
                const selected = option.id === modelId;
                return (
                  <button key={option.id} type="button" role="menuitem" onClick={() => selectModel(option)} style={{
                    width: '100%', padding: '8px 9px', border: 'none', borderRadius: 9,
                    display: 'flex', alignItems: 'flex-start', gap: 7, textAlign: 'left', cursor: 'pointer',
                    color: selected ? AMBER : 'inherit', background: selected ? `${AMBER}14` : 'transparent',
                    fontFamily: FONT,
                  }}>
                    <span style={{ flex: 1 }}>
                      <span style={{ display: 'block', fontSize: 11.5, fontWeight: selected ? 800 : 700 }}>{option.label}</span>
                      {option.description && <span style={{ display: 'block', marginTop: 1, color: '#8791A3', fontSize: 9.5, fontWeight: 500, lineHeight: 1.35 }}>{option.description}</span>}
                    </span>
                    {selected && <Check size={14} color={AMBER} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => canSend && onSend?.()}
          disabled={!canSend}
          title="Send message"
          aria-label="Send message"
          style={{
            width: 33, height: 33, padding: 0, border: 'none', borderRadius: 10, display: 'inline-flex',
            alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#fff',
            background: canSend ? AMBER : BORDER,
            boxShadow: canSend ? `0 5px 13px ${AMBER}42` : 'none', cursor: canSend ? 'pointer' : 'not-allowed',
            transition: 'background .16s, transform .16s',
          }}
        >
          <ArrowUp size={17} color={canSend ? '#fff' : '#9490A0'} />
        </button>
      </div>
    </div>
  );
}
