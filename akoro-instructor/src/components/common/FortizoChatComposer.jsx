/**
 * FortizoChatComposer — the instructor console's copy of the learner app's
 * shared composer (akoro-learner/src/components/common/FortizoChatComposer.jsx),
 * refined to its exact behaviour: the same input row over a second-row tool
 * rail, the same model menu (sections, meta badges, disabled options), and
 * the same running→stop affordance (send arrow becomes a ■ stop button).
 * Adapted to this app's system only in chrome: lucide icons, DM Sans, amber.
 *
 * The host owns every action. A model option is never sent as an arbitrary
 * model identifier: the host maps it to a supported API mode. `taskAction`
 * (instructor-only) follows the component's own pattern: a tool renders only
 * when the host provides it.
 */
import { useEffect, useRef, useState, isValidElement } from 'react';
import { Mic, Paperclip, CheckSquare, AudioLines } from 'lucide-react';
import { Ico } from '../../theme/Ico.jsx';
import { C, tint } from '../../theme/colors.js';

const SURFACE = 'var(--ak-input-bg)';
const RAIL_BORDER = 'var(--ak-border2)';
const MUTED_RAIL = 'var(--ak-text-sub)';

function ComposerTool({ icon: Icon, ti, label, onClick, disabled = false, active = false }) {
  const unavailable = disabled && !active;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      {...(active ? { 'aria-pressed': true } : {})}
      onClick={onClick}
      disabled={unavailable}
      style={{
        width: 33, height: 33, flexShrink: 0, display: 'inline-flex', alignItems: 'center',
        justifyContent: 'center', border: 'none', borderRadius: 10, cursor: unavailable ? 'default' : 'pointer',
        transition: 'background .16s, color .16s, transform .16s',
        color: active ? '#fff' : MUTED_RAIL,
        background: active ? C.brand : C.surface,
        boxShadow: '0 1px 4px rgba(30,41,59,.06)',
      }}
      onMouseEnter={e => { if (!unavailable && !active) { e.currentTarget.style.background = C.brand; e.currentTarget.style.color = '#fff'; e.currentTarget.style.transform = 'translateY(-1px)'; } }}
      onMouseLeave={e => { if (!unavailable && !active) { e.currentTarget.style.background = C.surface; e.currentTarget.style.color = MUTED_RAIL; e.currentTarget.style.transform = 'none'; } }}
    >
      <Ico ti={ti} size={16} />
    </button>
  );
}

/**
 * The chat-mode chip and its menu — the learner ModelSwitch's exact model:
 * each option is { id, label, description?, meta?, section?, disabled? };
 * `section` starts a group heading, a `disabled` option (e.g. "Coming soon")
 * is shown but can't be picked. The menu scrolls, opens above the rail, and
 * carries the full radio semantics.
 */
export function ModelSwitch({ modelId, modelLabel, modelOptions = [], onModelChange, disabled = false, unavailableTitle = '', icon: ChipIcon, iconTi }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selectable = !disabled && modelOptions.length > 0 && typeof onModelChange === 'function';

  useEffect(() => {
    const close = event => { if (!ref.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative', marginLeft: 2, minWidth: 0 }}>
      <button
        type="button"
        onClick={() => selectable && setOpen(o => !o)}
        disabled={!selectable}
        title={selectable ? 'Choose a supported chat mode' : (unavailableTitle || modelLabel)}
        aria-label={selectable ? `Mode: ${modelLabel}. Choose a mode` : modelLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', gap: 5, maxWidth: 190, padding: '7px 10px',
          border: 'none', borderRadius: 17, cursor: selectable ? 'pointer' : 'default',
          color: 'var(--ak-text-sub)', background: C.surface,
          fontSize: 11, fontWeight: 800, fontFamily: C.font, whiteSpace: 'nowrap', overflow: 'hidden',
          opacity: selectable ? 1 : .78,
        }}
      >
        {/* icon is the COMPONENT (a lucide icon is a forwardRef OBJECT — never
            branch on typeof); an element renders as-is, carrying its own
            props. Rendering a component object as a child is React #31. */}
        {ChipIcon == null
          ? <Ico ti="ti-sparkles" size={13} color={C.brand} />
          : isValidElement(ChipIcon)
            ? ChipIcon
            : <Ico ti={iconTi} size={13} color={C.brand} />}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{modelLabel}</span>
        {selectable && <Ico ti="ti-chevron-down" size={12} color={C.muted2} />}
      </button>

      {open && (
        <div role="menu" aria-label="Supported chat modes" style={{
          position: 'absolute', zIndex: 20, bottom: 42, left: 0, width: 270, padding: 5,
          maxHeight: 'min(70vh, 460px)', overflowY: 'auto',
          border: `1px solid ${C.border}`, borderRadius: 13,
          color: C.ink, background: C.surface,
          boxShadow: '0 13px 34px rgba(22,28,45,.24)',
        }}>
          {modelOptions.map(option => {
            const selected = option.id === modelId;
            const off = !!option.disabled;
            return (
              <div key={option.id}>
                {option.section && (
                  <div style={{ padding: '8px 9px 3px', fontSize: 9.5, fontWeight: 900, letterSpacing: '.07em', textTransform: 'uppercase', color: C.muted2, fontFamily: C.font }}>{option.section}</div>
                )}
                <button type="button" role="menuitemradio" aria-checked={selected} aria-disabled={off}
                  title={off ? (option.note || 'Coming soon') : undefined}
                  onClick={() => { if (off) return; onModelChange?.(option.id); setOpen(false); }} style={{
                    width: '100%', padding: '8px 9px', border: 'none', borderRadius: 9,
                    display: 'flex', alignItems: 'flex-start', gap: 7, textAlign: 'left', cursor: off ? 'not-allowed' : 'pointer',
                    color: selected ? C.brand : 'inherit', background: selected ? tint(8) : 'transparent',
                    opacity: off ? .55 : 1,
                    fontFamily: C.font,
                  }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: selected ? 900 : 800 }}>{option.label}</span>
                      {option.meta && (off
                        ? <span style={{ fontSize: 9, fontWeight: 900, color: '#B45309', background: 'rgba(245,158,11,.14)', borderRadius: 999, padding: '1px 7px', textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>{option.meta}</span>
                        : <span style={{ fontSize: 9.5, fontWeight: 800, color: C.muted2, textTransform: 'uppercase', letterSpacing: '.04em' }}>{option.meta}</span>)}
                    </span>
                    {option.description && <span style={{ display: 'block', marginTop: 1, color: C.muted2, fontSize: 10, fontWeight: 500, lineHeight: 1.35 }}>{option.description}</span>}
                  </span>
                  {selected && <Ico ti="ti-check" size={14} color={C.brand} />}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
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
  hideModelMenu = false,
  sendDisabled = false,
  // While a reply streams, the send arrow becomes a ■ stop button — the
  // learner composer's exact affordance. Hosts without onStop are unchanged.
  running = false,
  onStop,
  stopLabel = 'Stop',
}) {
  const composerRef = useRef(null);
  const canSend = !disabled && !sendDisabled;

  const sendFromKeyboard = event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (canSend) onSend?.();
    }
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
        onFocus={event => { event.currentTarget.parentElement.style.borderColor = C.brand; event.currentTarget.parentElement.style.boxShadow = `0 0 0 3px ${tint(11)}`; }}
        onBlur={event => { event.currentTarget.parentElement.style.borderColor = RAIL_BORDER; event.currentTarget.parentElement.style.boxShadow = '0 4px 14px rgba(30,41,59,.055)'; }}
        style={{
          display: 'block', width: '100%', height: 34, padding: '0 3px 8px', border: 0,
          outline: 'none', background: 'transparent', color: C.ink, fontSize: 13,
          fontWeight: 600, fontFamily: C.font,
        }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        {/* Task toggle renders only when the host provides it (instructor). */}
        {taskAction && (
          <ComposerTool icon={CheckSquare} ti="ti-square-check" label={taskLabel} onClick={taskAction} active={taskActive} />
        )}
        <ComposerTool icon={Mic} ti="ti-microphone" label={voiceLabel} onClick={voiceAction}
          disabled={disabled || !voiceAction} active={voiceActive} />
        <ComposerTool icon={Paperclip} ti="ti-paperclip" label={attachmentLabel} onClick={attachmentAction}
          disabled={disabled || attachmentUnavailable || !attachmentAction} />
        <ComposerTool icon={AudioLines} ti="ti-wave-sine" label={audioLabel} onClick={audioAction}
          disabled={disabled || audioUnavailable || !audioAction} active={audioActive} />

        {!hideModelMenu && (
          <ModelSwitch modelId={modelId} modelLabel={modelLabel} modelOptions={modelOptions}
            onModelChange={onModelChange} disabled={disabled}
            unavailableTitle={modelLabelDescription || 'Choose a supported chat mode'} />
        )}

        <div style={{ flex: 1 }} />
        {running && onStop ? (
          <button
            type="button"
            onClick={() => onStop()}
            title={stopLabel}
            aria-label={stopLabel}
            style={{
              width: 33, height: 33, padding: 0, borderRadius: 10, display: 'inline-flex',
              alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer',
              border: `1.5px solid ${RAIL_BORDER}`,
              background: C.surface,
            }}
          >
            <span style={{ width: 11, height: 11, borderRadius: 2, background: C.ink, display: 'block' }} />
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
              background: canSend ? C.brand : C.border,
              boxShadow: canSend ? `0 5px 13px ${tint(26)}` : 'none', cursor: canSend ? 'pointer' : 'not-allowed',
              transition: 'background .16s, transform .16s',
            }}
          >
            <Ico ti="ti-arrow-up" size={17} color={canSend ? '#fff' : C.muted2} />
          </button>
        )}
      </div>
    </div>
  );
}
