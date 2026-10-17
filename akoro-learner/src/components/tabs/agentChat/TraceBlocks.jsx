/**
 * TraceBlocks — one Agent Chat turn rendered the way a coding agent shows
 * its work (Grand Plan §13.4, D41):
 *
 *   🧠 Thought for 3 seconds ›        collapsible; streams open while running
 *   🔍 Checking your goals ✓ 120ms ›  collapsible; What I checked / What I found
 *   >_ Checked 3 things ›             consecutive tool rows, grouped
 *   📖 Read 2 sources ›               consecutive reads, grouped
 *   ✎ Created a task · Revise … ›     change rows: what the agent changed
 *   plain text                         what the agent wrote between steps
 *
 * Interleaved in whatever order the turn produced them, as many times as the
 * tool loop ran. Learner language only — tool names appear only in the
 * opt-in developer view, which shows the raw name, arguments and output.
 */
import { useEffect, useState } from 'react';
import { BRAND, GREEN, RED } from '../../../constants.js';
import { Icon } from '../../common/Icons.jsx';
import RichText from '../../common/RichText.jsx';
import StreamCaret from '../../common/StreamCaret.jsx';
import { useLang } from '../../../contexts/LanguageContext.jsx';
import {
  durationLabel, groupLabel, groupTraceBlocks, thoughtLabel,
} from '../../../lib/agentChatTrace.js';

const MUTED = 'var(--ak-text-muted)';
const ROW_FONT = { fontSize: 12.5, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" };

/** Live elapsed ms for a running row (re-renders once a second). */
function useElapsed(running, startedAt) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return running && startedAt ? Math.max(0, now - startedAt) : 0;
}

function Chevron({ open }) {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2.4"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }}>
      <polyline points="9 6 15 12 9 18"/>
    </svg>
  );
}

function SmallSpinner() {
  return <span aria-hidden style={{ width: 11, height: 11, borderRadius: '50%', border: `1.6px solid ${BRAND}40`, borderTopColor: BRAND, display: 'inline-block', animation: 'ak-trace-spin .8s linear infinite', flexShrink: 0 }}/>;
}

function RowButton({ children, onClick, expanded, label }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={expanded} aria-label={label}
      style={{ display: 'flex', alignItems: 'center', gap: 7, width: '100%', padding: '4px 0', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', color: MUTED, ...ROW_FONT }}>
      {children}
    </button>
  );
}

/** 🧠 Thought for N seconds — opens itself while reasoning streams, collapses when done. */
export function ThinkingRow({ block }) {
  const { t } = useLang();
  const running = block.status === 'running';
  const streamsText = block.source === 'reasoning';
  const [open, setOpen] = useState(null);          // null = follow the stream
  const expanded = open ?? (running && streamsText);
  const elapsed = useElapsed(running, block.startedAt);
  const label = running ? t('agent.trace_thinking') : thoughtLabel(block.ms || elapsed);
  const hasBody = Boolean(block.text);
  return (
    <div>
      <RowButton onClick={() => hasBody && setOpen(!expanded)} expanded={expanded} label={label}>
        {running ? <SmallSpinner/> : <Icon name="ti-brain" size={13} color={MUTED}/>}
        <span style={{ fontWeight: 600 }}>{label}</span>
        {hasBody && <Chevron open={expanded}/>}
      </RowButton>
      {expanded && hasBody && (
        <div style={{ margin: '2px 0 6px 6px', padding: '2px 0 2px 12px', borderLeft: '2px solid var(--ak-border)', color: MUTED, fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', fontFamily: "ui-monospace,'SF Mono',Menlo,monospace" }}>
          {block.text}{running && <StreamCaret/>}
        </div>
      )}
    </div>
  );
}

const PANEL_LABEL = { fontSize: 9.5, fontWeight: 900, letterSpacing: .6, textTransform: 'uppercase', color: MUTED, marginBottom: 3 };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

/** ISO dates read as local dates; everything else as given. */
function fieldValue(value) {
  const text = String(value ?? '');
  if (!ISO_DATE.test(text)) return text;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return text.length > 10
    ? date.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard unavailable */ }
  };
  return (
    <button type="button" onClick={copy} aria-label={copied ? 'Copied' : 'Copy'} title={copied ? 'Copied' : 'Copy'}
      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', color: copied ? GREEN : MUTED }}>
      <Icon name={copied ? 'ti-check' : 'ti-copy'} size={13}/>
    </button>
  );
}

/** Developer view: COMMAND / ARGUMENTS / OUTPUT boxes with copy buttons. */
function RawPanel({ label, text }) {
  if (!text) return null;
  return (
    <div style={{ padding: '7px 11px', borderTop: '1px solid var(--ak-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={PANEL_LABEL}>{label}</div>
        <CopyButton text={text}/>
      </div>
      <pre style={{ margin: 0, maxHeight: 220, overflow: 'auto', fontSize: 11.5, lineHeight: 1.5, color: 'var(--ak-text-sub)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: "ui-monospace,'SF Mono',Menlo,monospace" }}>{text}</pre>
    </div>
  );
}

function RawPanels({ raw }) {
  if (!raw) return null;
  return (
    <>
      <RawPanel label="Tool" text={raw.name}/>
      <RawPanel label="Arguments" text={raw.args}/>
      <RawPanel label="Output" text={raw.output}/>
    </>
  );
}

const TOOL_ICON = { action: 'ti-bolt', read: 'ti-book', research: 'ti-search' };

/** 🔍 Checking your goals ✓ 120ms — expands to What I checked / What I found. */
export function ToolRow({ block, nested = false }) {
  const [open, setOpen] = useState(false);
  const running = block.status === 'running';
  const elapsed = useElapsed(running, block.startedAt);
  const icon = TOOL_ICON[block.category] || 'ti-search';
  return (
    <div style={nested ? { paddingLeft: 4 } : undefined}>
      <RowButton onClick={() => setOpen(!open)} expanded={open} label={block.headline}>
        {running ? <SmallSpinner/> : <Icon name={icon} size={13} color={MUTED}/>}
        <span style={{ fontWeight: 600, color: 'var(--ak-text-sub)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{block.headline}</span>
        {block.status === 'done' && (block.ok === false
          ? <span style={{ color: RED, fontWeight: 800, fontSize: 12 }}>✕</span>
          : <span style={{ color: GREEN, fontWeight: 800, fontSize: 12 }}>✓</span>)}
        {block.status === 'stopped' && <span style={{ fontSize: 11 }}>stopped</span>}
        {(running || block.ms != null) && <span style={{ fontSize: 11, opacity: .85, flexShrink: 0 }}>{durationLabel(block.ms || elapsed)}</span>}
        <Chevron open={open}/>
      </RowButton>
      {open && (
        <div style={{ margin: '2px 0 8px 20px', border: '1px solid var(--ak-border)', borderRadius: 10, overflow: 'hidden', background: 'var(--ak-surface-hover)' }}>
          <div style={{ padding: '7px 11px', borderBottom: '1px solid var(--ak-border)' }}>
            <div style={PANEL_LABEL}>What I checked</div>
            <div style={{ fontSize: 12.5, color: 'var(--ak-text-sub)', lineHeight: 1.5 }}>{block.description || block.headline}</div>
          </div>
          <div style={{ padding: '7px 11px' }}>
            <div style={PANEL_LABEL}>What I found</div>
            <div style={{ fontSize: 12.5, color: block.ok === false ? RED : 'var(--ak-text-sub)', lineHeight: 1.5 }}>
              {running ? 'Working on it…' : (block.result || (block.status === 'stopped' ? 'Stopped' : 'Done'))}
            </div>
            {block.items?.length > 0 && (
              <ul style={{ margin: '4px 0 0', paddingLeft: 18, listStyle: 'disc', fontSize: 12.5, color: 'var(--ak-text-sub)', lineHeight: 1.55 }}>
                {block.items.map((item, index) => <li key={index}>{item}</li>)}
              </ul>
            )}
          </div>
          <RawPanels raw={block.raw}/>
        </div>
      )}
    </div>
  );
}

/** ✎ Created a task · Revise photosynthesis — what the agent changed; expands to the details. */
export function ChangeRow({ block }) {
  const [open, setOpen] = useState(false);
  const { change } = block;
  const label = change.title ? `${change.label} · ${change.title}` : change.label;
  const hasDetails = Boolean(change.fields?.length || block.raw);
  return (
    <div>
      <RowButton onClick={() => hasDetails && setOpen(!open)} expanded={open} label={label}>
        <Icon name="ti-pencil" size={13} color={GREEN}/>
        <span style={{ fontWeight: 600, color: 'var(--ak-text-sub)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
          {change.label}{change.title && <span style={{ fontWeight: 700, color: 'var(--ak-text)' }}> · {change.title}</span>}
        </span>
        <span style={{ fontSize: 11, opacity: .85, flexShrink: 0 }}>{durationLabel(block.ms)}</span>
        {hasDetails && <Chevron open={open}/>}
      </RowButton>
      {open && (
        <div style={{ margin: '2px 0 8px 20px', border: '1px solid var(--ak-border)', borderRadius: 10, overflow: 'hidden', background: 'var(--ak-surface-hover)' }}>
          {change.fields?.length > 0 && (
            <div style={{ padding: '7px 11px', display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 12, rowGap: 3, fontSize: 12.5 }}>
              {change.fields.map((field) => (
                <div key={field.label} style={{ display: 'contents' }}>
                  <span style={{ color: MUTED, fontWeight: 700 }}>{field.label}</span>
                  <span style={{ color: 'var(--ak-text-sub)', overflowWrap: 'anywhere' }}>{fieldValue(field.value)}</span>
                </div>
              ))}
            </div>
          )}
          <RawPanels raw={block.raw}/>
        </div>
      )}
    </div>
  );
}

/** >_ Checked 3 things — consecutive tool rows, each expandable again. */
export function ToolGroup({ group }) {
  const [open, setOpen] = useState(false);
  const running = group.tools.some((tool) => tool.status === 'running');
  const failed = group.tools.some((tool) => tool.ok === false);
  const label = groupLabel(group.tools);
  const reads = group.tools.every((tool) => tool.category === 'read');
  return (
    <div>
      <RowButton onClick={() => setOpen(!open)} expanded={open} label={label}>
        {running ? <SmallSpinner/> : reads
          ? <Icon name="ti-book" size={13} color={MUTED}/>
          : <span style={{ fontFamily: "ui-monospace,'SF Mono',Menlo,monospace", fontSize: 11.5, fontWeight: 700, color: MUTED }}>&gt;_</span>}
        <span style={{ fontWeight: 600, color: 'var(--ak-text-sub)' }}>{label}</span>
        {!running && (failed
          ? <span style={{ color: RED, fontWeight: 800, fontSize: 12 }}>✕</span>
          : <span style={{ color: GREEN, fontWeight: 800, fontSize: 12 }}>✓</span>)}
        <Chevron open={open}/>
      </RowButton>
      {open && (
        <div style={{ marginLeft: 6, paddingLeft: 10, borderLeft: '2px solid var(--ak-border)' }}>
          {group.tools.map((tool) => <ToolRow key={tool.id} block={tool} nested/>)}
        </div>
      )}
    </div>
  );
}

/** Text the agent wrote between steps — unboxed, like the reply; streams word by word. */
export function ActivityText({ block }) {
  return (
    <div style={{ fontSize: 14.5, lineHeight: 1.65, color: 'var(--ak-text)', margin: '4px 0 6px' }}>
      <RichText text={block.text}/>{block.status === 'running' && <StreamCaret/>}
    </div>
  );
}

/** The whole interleaved trace of one turn. */
export default function TraceBlocks({ blocks }) {
  if (!blocks?.length) return null;
  const items = groupTraceBlocks(blocks);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginBottom: 4 }}>
      <style>{'@keyframes ak-trace-spin{to{transform:rotate(360deg)}}'}</style>
      {items.map((item) => {
        if (item.type === 'thinking') return <ThinkingRow key={item.id} block={item}/>;
        if (item.type === 'tool' && item.change) return <ChangeRow key={item.id} block={item}/>;
        if (item.type === 'tool') return <ToolRow key={item.id} block={item}/>;
        if (item.type === 'group') return <ToolGroup key={item.id} group={item}/>;
        if (item.type === 'activity') return <ActivityText key={item.id} block={item}/>;
        return null;
      })}
    </div>
  );
}
