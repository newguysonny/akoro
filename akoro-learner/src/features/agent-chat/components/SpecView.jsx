/*
 * SpecView — renders a built tool's declarative presentation (Plugin
 * Runtime): the fixed UI catalogue from the API's uiCatalogue.js, nothing
 * else. No generated code ever reaches the client — a presentation is data:
 * components whose string props may be bindings ("$state.coverage",
 * "$rows", "$tool.label") resolved against the data the host passes in
 * (a mode tool's live state, or a data tool's rows).
 *
 * Used in two places: as a live preview on the tool's build card (inside
 * the chat, where a cta's message is sent straight into the conversation),
 * and as the tool's own tab opened from Settings → My tools (where the
 * host stashes the cta message and brings the learner to the chat).
 */
import { Icon } from '../../../components/common/Icons.jsx';
import { BRAND } from '../../../constants.js';

const NUNITO = "'Nunito',sans-serif";
const GREEN = '#10B981';

const isBinding = (v) => typeof v === 'string' && v.startsWith('$');

/** "$state.coverage.0.title" → walk { state, rows, tool, params }. */
export function resolveBinding(v, data = {}) {
  if (!isBinding(v)) return v;
  const parts = v.slice(1).split('.').filter((p) => p.length);
  let cur = data[parts[0]];
  for (const p of parts.slice(1)) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

const text = (v) => (v == null ? '' : String(v));

const HERO_ICONS = { book: 'ti-book', cap: 'ti-school', chart: 'ti-chart-bar', target: 'ti-target', clock: 'ti-clock', star: 'ti-star' };

function Hero({ c, data }) {
  const title = text(resolveBinding(c.title, data));
  const sub = text(resolveBinding(c.sub, data));
  return (
    <div style={{ borderRadius: 16, padding: '16px 15px', background: `linear-gradient(135deg, ${BRAND} 0%, #8B5CF6 100%)`, color: '#fff', fontFamily: NUNITO }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 38, height: 38, borderRadius: 12, background: 'rgba(255,255,255,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon name={HERO_ICONS[c.icon] || 'ti-sparkles'} size={20} color="#fff" />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16.5, fontWeight: 900, lineHeight: 1.25 }}>{title}</div>
          {sub && <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.85, marginTop: 2 }}>{sub}</div>}
        </div>
      </div>
    </div>
  );
}

function StatRow({ c, data }) {
  const stats = (c.stats || []).slice(0, 4);
  if (!stats.length) return null;
  return (
    <div style={{ display: 'flex', gap: 8, fontFamily: NUNITO }}>
      {stats.map((s, i) => (
        <div key={i} style={{ flex: 1, minWidth: 0, borderRadius: 14, background: 'var(--ak-surface2, #F3F1FF)', padding: '10px 8px', textAlign: 'center' }}>
          <div style={{ fontSize: 19, fontWeight: 900, color: 'var(--ak-text)', lineHeight: 1.1 }}>{text(resolveBinding(s.value, data)) || '0'}</div>
          <div style={{ fontSize: 9.5, fontWeight: 800, color: 'var(--ak-text-muted)', letterSpacing: 0.6, marginTop: 3 }}>{text(resolveBinding(s.label, data)).toUpperCase()}</div>
        </div>
      ))}
    </div>
  );
}

function Stepper({ c, data }) {
  const steps = c.steps || [];
  if (!steps.length) return null;
  let states = steps.map((s) => s.state || 'next');
  if (c.bind) {
    const phase = resolveBinding(c.bind, data);
    const idx = c.map && phase != null && c.map[phase] != null ? Number(c.map[phase]) : 0;
    states = steps.map((_, i) => (i < idx ? 'done' : i === idx ? 'now' : 'next'));
  }
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', fontFamily: NUNITO, padding: '2px 2px 0' }}>
      {steps.map((s, i) => {
        const st = states[i];
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', minWidth: 0 }}>
            {i > 0 && <span style={{ position: 'absolute', top: 11, right: '50%', width: '100%', height: 2.5, background: states[i - 1] === 'done' || st === 'done' ? GREEN : 'var(--ak-border)', zIndex: 0 }} />}
            <span style={{ width: 22, height: 22, borderRadius: '50%', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: st === 'done' ? GREEN : st === 'now' ? BRAND : 'var(--ak-surface)', border: st === 'next' ? '2px solid var(--ak-border)' : 'none' }}>
              {st === 'done' ? <Icon name="ti-check" size={12} color="#fff" /> : st === 'now' ? <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff' }} /> : null}
            </span>
            <span style={{ fontSize: 10.5, fontWeight: 800, marginTop: 5, color: st === 'next' ? 'var(--ak-text-muted)' : 'var(--ak-text)', textAlign: 'center' }}>{text(resolveBinding(s.label, data))}</span>
          </div>
        );
      })}
    </div>
  );
}

const ROW_STATE = {
  done: { icon: 'ti-circle-check', color: GREEN },
  partial: { icon: 'ti-circle-half-2', color: '#F59E0B' },
  todo: { icon: 'ti-circle', color: 'var(--ak-text-muted)' },
  hidden: { icon: 'ti-lock', color: 'var(--ak-text-muted)' },
};

function List({ c, data }) {
  const items = resolveBinding(c.items, data);
  const rows = Array.isArray(items) ? items : [];
  const map = c.item || {};
  const field = (row, spec) => {
    if (spec == null) return undefined;
    if (isBinding(spec)) return resolveBinding(spec, { ...data, state: { ...(data.state || {}), item: row } });
    return row?.[spec];
  };
  return (
    <div style={{ fontFamily: NUNITO }}>
      {c.title && <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--ak-text)', letterSpacing: 0.4, marginBottom: 7 }}>{text(resolveBinding(c.title, data)).toUpperCase()}</div>}
      <div style={{ borderRadius: 14, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', overflow: 'hidden' }}>
        {rows.length === 0 && <div style={{ padding: '11px 13px', fontSize: 12.5, fontWeight: 700, color: 'var(--ak-text-muted)' }}>Nothing here yet.</div>}
        {rows.map((row, i) => {
          const st = map.stateField ? String(row?.[map.stateField] || 'todo') : null;
          const hidden = st === 'hidden';
          const meta = st ? (ROW_STATE[st] || ROW_STATE.todo) : null;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 13px', borderTop: i ? '1px solid var(--ak-border)' : 'none' }}>
              {meta && <Icon name={meta.icon} size={17} color={meta.color} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: hidden ? 'var(--ak-text-muted)' : 'var(--ak-text)', lineHeight: 1.35 }}>
                  {hidden ? (c.hiddenLabel || 'Hidden until review') : text(field(row, map.title))}
                </div>
                {!hidden && field(row, map.sub) != null && (
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ak-text-muted)', marginTop: 1 }}>{text(field(row, map.sub))}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CardGrid({ c, data }) {
  const items = resolveBinding(c.items, data);
  const rows = Array.isArray(items) ? items : [];
  const map = c.item || {};
  if (!rows.length) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontFamily: NUNITO }}>
      {rows.map((row, i) => (
        <div key={i} style={{ borderRadius: 14, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', padding: '11px 12px' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ak-text)', lineHeight: 1.35 }}>{text(row?.[map.title || 'title'])}</div>
          {map.sub && row?.[map.sub] != null && <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ak-text-muted)', marginTop: 2 }}>{text(row[map.sub])}</div>}
        </div>
      ))}
    </div>
  );
}

function Table({ c, data }) {
  const rows = resolveBinding(c.rows, data);
  const list = Array.isArray(rows) ? rows : [];
  const cols = c.columns || [];
  if (!cols.length) return null;
  return (
    <div style={{ borderRadius: 14, border: '1px solid var(--ak-border)', overflow: 'hidden', fontFamily: NUNITO, background: 'var(--ak-surface)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead>
          <tr>{cols.map((col, i) => <th key={i} style={{ textAlign: 'left', padding: '9px 12px', fontWeight: 900, color: 'var(--ak-text-muted)', fontSize: 11, letterSpacing: 0.4, background: 'var(--ak-surface2, #F3F1FF)' }}>{text(col.label)}</th>)}</tr>
        </thead>
        <tbody>
          {list.map((row, i) => (
            <tr key={i}>{cols.map((col, j) => <td key={j} style={{ padding: '8px 12px', fontWeight: 700, color: 'var(--ak-text)', borderTop: '1px solid var(--ak-border)' }}>{text(row?.[col.field])}</td>)}</tr>
          ))}
        </tbody>
      </table>
      {list.length === 0 && <div style={{ padding: '11px 13px', fontSize: 12.5, fontWeight: 700, color: 'var(--ak-text-muted)' }}>Nothing here yet.</div>}
    </div>
  );
}

function Detail({ c, data }) {
  const fields = c.fields || [];
  if (!fields.length) return null;
  return (
    <div style={{ borderRadius: 14, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', padding: '6px 13px', fontFamily: NUNITO }}>
      {fields.map((f, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderTop: i ? '1px solid var(--ak-border)' : 'none' }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--ak-text-muted)' }}>{text(resolveBinding(f.label, data))}</span>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)', textAlign: 'right' }}>{text(resolveBinding(f.value, data))}</span>
        </div>
      ))}
    </div>
  );
}

function Chart({ c, data }) {
  const rows = resolveBinding(c.rows, data);
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;
  const max = Math.max(...list.map((r) => Number(r?.[c.y]) || 0), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 110, padding: '6px 2px 0', fontFamily: NUNITO }}>
      {list.slice(0, 12).map((row, i) => {
        const v = Number(row?.[c.y]) || 0;
        return (
          <div key={i} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, height: '100%', justifyContent: 'flex-end' }}>
            <span style={{ fontSize: 10.5, fontWeight: 900, color: 'var(--ak-text)' }}>{v}</span>
            <div style={{ width: '100%', maxWidth: 30, height: `${Math.max(4, (v / max) * 62)}px`, borderRadius: '7px 7px 3px 3px', background: BRAND }} />
            <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--ak-text-muted)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text(row?.[c.x])}</span>
          </div>
        );
      })}
    </div>
  );
}

const RENDERERS = {
  hero: Hero,
  statRow: StatRow,
  stepper: Stepper,
  list: List,
  cardGrid: CardGrid,
  table: Table,
  detail: Detail,
  markdown: ({ c, data }) => (
    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ak-text)', lineHeight: 1.55, fontFamily: NUNITO, whiteSpace: 'pre-wrap' }}>{text(resolveBinding(c.text, data))}</div>
  ),
  image: ({ c, data }) => {
    const src = resolveBinding(c.src, data);
    if (typeof src !== 'string' || !/^https:\/\//.test(src)) return null;
    return <img src={src} alt={text(resolveBinding(c.alt, data))} style={{ width: '100%', borderRadius: 14, display: 'block' }} />;
  },
  cta: ({ c, data, onSend }) => (
    <button type="button" onClick={() => onSend && onSend(text(resolveBinding(c.message, data)))}
      style={{ width: '100%', padding: '12px 14px', borderRadius: 13, border: 'none', background: BRAND, color: '#fff', fontSize: 13.5, fontWeight: 900, fontFamily: NUNITO, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
      {text(resolveBinding(c.label, data))}
      <Icon name="ti-arrow-right" size={15} color="#fff" />
    </button>
  ),
};

export default function SpecView({ presentation, state = null, rows = null, tool = null, params = null, onSend = null }) {
  if (!presentation || !Array.isArray(presentation.body) || !presentation.body.length) return null;
  const data = { state: state || {}, rows: rows || [], tool: tool || {}, params: params || {} };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {presentation.body.map((c, i) => {
        const R = RENDERERS[c?.type];
        return R ? <R key={i} c={c} data={data} onSend={onSend} /> : null;
      })}
    </div>
  );
}
