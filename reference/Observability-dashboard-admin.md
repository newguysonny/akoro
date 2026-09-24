import { useState } from 'react';
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

// ── Akoro brand tokens ────────────────────────────────────────────────────────
const C = {
  bg:      '#060D1A',
  s1:      '#0B1829',  // card surface
  s2:      '#0F1E30',  // raised surface
  s3:      '#152440',  // tooltip / popover
  b:       'rgba(255,255,255,0.06)',   // border
  bm:      'rgba(255,255,255,0.10)',   // border mid
  bb:      'rgba(196,154,60,0.22)',    // border brass
  brass:   '#C49A3C',
  brassL:  '#D4A94A',
  brassF:  'rgba(196,154,60,0.10)',
  brassF2: 'rgba(196,154,60,0.06)',
  text:    '#E8F0F8',
  sub:     '#507090',
  dim:     '#2A4060',
  green:   '#2DB887',  greenF: 'rgba(45,184,135,0.10)',
  yellow:  '#E5A817',  yellowF:'rgba(229,168,23,0.10)',
  red:     '#E05050',  redF:   'rgba(224,80,80,0.10)',
  blue:    '#4C8EE0',  blueF:  'rgba(76,142,224,0.10)',
};

// ── Grafana embed config ──────────────────────────────────────────────────────
// Replace values with real panel embed URLs from Grafana Cloud.
// In Grafana: open the panel → Share → Embed → copy the iframe src URL.
export const GRAFANA_PANELS = {
  cpu:      '', // e.g. 'https://your-stack.grafana.net/d-solo/abc/node?panelId=1&...'
  memory:   '',
  pgConn:   '',
  cacheHit: '',
  aiMs:     '',
  aiCalls:  '',
};

// ── Mock data (replace with live API calls to Grafana / Prometheus) ───────────
function gen(n, base, range) {
  return Array.from({ length: n }, (_, i) => ({
    i,
    v: parseFloat(
      Math.max(0, base + Math.sin(i * 0.5) * range * 0.6 + (Math.random() - 0.5) * range * 0.45)
        .toFixed(1)
    ),
  }));
}

const MOCK_DATA = {
  rps:      gen(24, 84, 36),
  p50:      gen(24, 54, 18),
  p95:      gen(24, 116, 44),
  p99:      gen(24, 242, 82),
  cpu:      gen(24, 43, 22),
  mem:      gen(24, 66, 10),
  pgConn:   gen(24, 6, 2).map(d => ({ ...d, v: Math.max(1, Math.round(d.v)) })),
  cacheHit: gen(24, 97.1, 1.4),
  aiMs:     gen(24, 1140, 310),
  aiCalls:  gen(24, 11, 6).map(d => ({ ...d, v: Math.max(0, Math.round(d.v)) })),
};

const AGENT_COLORS = {
  'NaNa Esumai': C.brass,
  'Sargeant':    C.blue,
  'Prof. Ade':   C.green,
};

// ── Akoro "A" logomark ────────────────────────────────────────────────────────
// Two converging strokes resolving into a brass node at the apex.
function AkoroMark({ size = 24 }) {
  const h = Math.round(size * 26 / 24);
  return (
    <svg width={size} height={h} viewBox="0 0 24 26" fill="none" aria-hidden="true">
      <line x1="1"  y1="24" x2="12" y2="4" stroke={C.brass} strokeWidth="2.2" strokeLinecap="round" />
      <line x1="23" y1="24" x2="12" y2="4" stroke={C.brass} strokeWidth="2.2" strokeLinecap="round" />
      <line x1="5.5" y1="17" x2="18.5" y2="17" stroke={C.brass} strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="4" r="3" fill={C.brass} />
    </svg>
  );
}

// ── Chart tooltip ─────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, unit = '' }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: C.s3, border: `1px solid ${C.bb}`, borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.text }}>
          <span style={{ width: 10, height: 2, background: p.color, display: 'inline-block', borderRadius: 1 }} />
          <span style={{ color: C.sub, fontSize: 11 }}>{p.name}:</span>
          <strong style={{ color: C.text }}>{p.value}{unit}</strong>
        </div>
      ))}
    </div>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────
function Card({ children, style = {} }) {
  return (
    <div style={{ background: C.s1, border: `1px solid ${C.b}`, borderRadius: 12, overflow: 'hidden', ...style }}>
      {children}
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
const BADGE_STYLES = {
  green:  { bg: C.greenF,  color: C.green  },
  yellow: { bg: C.yellowF, color: C.yellow },
  red:    { bg: C.redF,    color: C.red    },
  brass:  { bg: C.brassF,  color: C.brassL },
};

function Stat({ label, value, unit, badge, badgeColor = 'green' }) {
  const bs = BADGE_STYLES[badgeColor] ?? BADGE_STYLES.green;
  return (
    <Card style={{ padding: '15px 16px', display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 10.5, color: C.sub, fontWeight: 500, letterSpacing: '.04em' }}>
        {label}
      </span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
        <span style={{ fontSize: 24, fontWeight: 600, color: C.text, letterSpacing: '-.03em', lineHeight: 1 }}>
          {value}
        </span>
        {unit && <span style={{ fontSize: 12, color: C.sub }}>{unit}</span>}
      </div>
      {badge && (
        <span style={{
          fontSize: 10.5, fontWeight: 500, padding: '2px 8px', borderRadius: 100,
          alignSelf: 'flex-start', background: bs.bg, color: bs.color,
        }}>
          {badge}
        </span>
      )}
    </Card>
  );
}

// ── Single-series area chart ──────────────────────────────────────────────────
let gradientCounter = 0;

function AreaPanel({ title, sub, data, color, unit = '', domain }) {
  const gradId = `akoro-grad-${++gradientCounter}`;
  return (
    <Card>
      <div style={{ padding: '12px 16px 0', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: C.text }}>{title}</span>
        {sub && <span style={{ fontSize: 10.5, color: C.sub }}>{sub}</span>}
      </div>
      <div style={{ padding: '6px 8px 10px' }}>
        <ResponsiveContainer width="100%" height={110}>
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={color} stopOpacity={0.22} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" strokeDasharray="3 4" />
            <XAxis dataKey="i" hide />
            <YAxis
              domain={domain ?? ['auto', 'auto']}
              tick={{ fontSize: 10, fill: C.dim }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={(props) => <ChartTooltip {...props} unit={unit} />} />
            <Area
              type="monotone"
              dataKey="v"
              stroke={color}
              strokeWidth={1.8}
              fill={`url(#${gradId})`}
              dot={false}
              name={title}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

// ── Multi-series line chart ───────────────────────────────────────────────────
function MultiPanel({ title, series }) {
  const data = series[0].data.map((d, i) => {
    const pt = { i };
    series.forEach(s => { pt[s.key] = s.data[i].v; });
    return pt;
  });

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px 0' }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: C.text }}>{title}</span>
        <div style={{ display: 'flex', gap: 10 }}>
          {series.map(s => (
            <span key={s.key} style={{ fontSize: 10.5, color: C.sub, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 12, height: 2, background: s.color, display: 'inline-block', borderRadius: 1 }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <div style={{ padding: '6px 8px 10px' }}>
        <ResponsiveContainer width="100%" height={120}>
          <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" strokeDasharray="3 4" />
            <XAxis dataKey="i" hide />
            <YAxis tick={{ fontSize: 10, fill: C.dim }} tickLine={false} axisLine={false} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div style={{ background: C.s3, border: `1px solid ${C.bb}`, borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
                    {payload.map((p, i) => {
                      const s = series.find(s => s.key === p.dataKey);
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.text }}>
                          <span style={{ width: 10, height: 2, background: p.color, display: 'inline-block', borderRadius: 1 }} />
                          <span style={{ color: C.sub, fontSize: 11 }}>{s?.label}:</span>
                          <strong>{p.value}{s?.unit ?? ''}</strong>
                        </div>
                      );
                    })}
                  </div>
                );
              }}
            />
            {series.map(s => (
              <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={1.8} dot={false} name={s.label} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

// ── Embed panel (iframe or setup instructions) ────────────────────────────────
function EmbedPanel({ title, sub, embedUrl, fallback }) {
  const [showSetup, setShowSetup] = useState(false);
  const live = !!embedUrl && !showSetup;

  return (
    <Card>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', borderBottom: `1px solid ${C.b}`,
      }}>
        <div>
          <span style={{ fontSize: 12, fontWeight: 500, color: C.text }}>{title}</span>
          {sub && <span style={{ display: 'block', fontSize: 10.5, color: C.sub, marginTop: 1 }}>{sub}</span>}
        </div>
        <button
          onClick={() => setShowSetup(v => !v)}
          style={{ fontSize: 10.5, color: C.sub, background: 'none', border: `1px solid ${C.b}`, borderRadius: 6, padding: '2px 9px', lineHeight: '1.6' }}
        >
          {live ? <span style={{ color: C.green }}>● live</span> : 'setup'}
        </button>
      </div>
      {live
        ? <iframe src={embedUrl} style={{ width: '100%', height: 180, border: 'none', display: 'block' }} title={title} />
        : embedUrl && !showSetup
          ? null  // live case handled above
          : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '24px 20px', minHeight: 160 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: C.brassF, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <i className="ti ti-chart-area-line" style={{ fontSize: 20, color: C.brass }} aria-hidden="true" />
              </div>
              <p style={{ fontSize: 12, color: C.sub, lineHeight: 1.8, textAlign: 'center', margin: 0 }}>
                In Grafana Cloud: open the panel<br />
                → Share → Embed → copy the{' '}
                <code style={{ color: C.brassL, fontSize: 11, fontFamily: 'monospace' }}>src</code> URL<br />
                into <code style={{ color: C.brassL, fontSize: 11, fontFamily: 'monospace' }}>GRAFANA_PANELS</code>
              </p>
              {embedUrl && (
                <button onClick={() => setShowSetup(false)} style={{ fontSize: 11, color: C.brassL, background: 'none', border: 'none' }}>
                  Show embed ↗
                </button>
              )}
            </div>
          )
      }
      {/* When no URL, render the chart fallback so the panel isn't empty */}
      {!embedUrl && fallback}
    </Card>
  );
}

// ── Disk usage bar ────────────────────────────────────────────────────────────
function DiskBar({ label, pct }) {
  const color = pct > 80 ? C.red : pct > 60 ? C.yellow : C.green;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.sub, marginBottom: 6 }}>
        <span>{label}</span>
        <span style={{ color, fontWeight: 500 }}>{pct}%</span>
      </div>
      <div style={{ height: 3, background: C.s3, borderRadius: 2 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2 }} />
      </div>
    </div>
  );
}

// ── Agent activity row ────────────────────────────────────────────────────────
function AgentRow({ agent, action, ms, ago, ok }) {
  const color = AGENT_COLORS[agent] ?? C.sub;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: `1px solid ${C.b}` }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: ok ? color : C.yellow, flexShrink: 0, boxShadow: ok ? `0 0 6px ${color}55` : 'none' }} />
      <span style={{ fontSize: 11.5, fontWeight: 600, color, whiteSpace: 'nowrap', width: 90, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {agent}
      </span>
      <span style={{ fontSize: 11.5, color: C.sub, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {action}
      </span>
      <span style={{ fontSize: 11, color: ok ? C.dim : C.yellow, whiteSpace: 'nowrap', fontWeight: ok ? 400 : 500 }}>{ms}</span>
      <span style={{ fontSize: 11, color: C.dim, whiteSpace: 'nowrap' }}>{ago}</span>
    </div>
  );
}

// ── Tab nav ───────────────────────────────────────────────────────────────────
const TABS = ['Overview', 'Infrastructure', 'Database', 'AI / LLM'];

// ── Main component ────────────────────────────────────────────────────────────
export default function ObservabilityDashboard() {
  const [tab, setTab] = useState('Overview');
  const [spinning, setSpinning] = useState(false);

  const refresh = () => {
    setSpinning(true);
    setTimeout(() => setSpinning(false), 800);
    // TODO: refetch live data here
  };

  const grid2 = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 };

  return (
    <div style={{ background: C.bg, minHeight: '100vh', fontFamily: "'Inter', sans-serif", paddingBottom: 36 }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ padding: '20px 18px 0', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <AkoroMark />
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 17, fontWeight: 600, color: C.text, letterSpacing: '-.02em' }}>
                  <span style={{ color: C.brass }}>Ak</span>oro
                </span>
                <span style={{ fontSize: 11, color: C.dim, fontWeight: 500, letterSpacing: '.04em' }}>· ADMIN</span>
              </div>
              <p style={{ fontSize: 11.5, color: C.sub, margin: '2px 0 0', letterSpacing: '.01em' }}>
                System observability
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
            <span style={{
              fontSize: 11, padding: '4px 11px', borderRadius: 100,
              background: C.greenF, color: C.green, fontWeight: 500,
              border: 'rgba(45,184,135,0.2) 1px solid',
            }}>
              ● All systems operational
            </span>
            <button
              onClick={refresh}
              aria-label="Refresh data"
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: `1px solid ${C.b}`, borderRadius: 8, padding: '6px 10px', fontSize: 11.5, color: C.sub }}
            >
              <i className={`ti ti-refresh${spinning ? ' spin' : ''}`} style={{ fontSize: 13 }} aria-hidden="true" />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <div role="tablist" style={{ display: 'flex', padding: '0 18px', borderBottom: `1px solid ${C.b}`, marginBottom: 18, overflowX: 'auto' }}>
        {TABS.map(t => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            style={{
              padding: '10px 14px', border: 'none',
              borderBottom: tab === t ? `2px solid ${C.brass}` : '2px solid transparent',
              background: 'transparent', fontSize: 12.5, fontWeight: 500,
              color: tab === t ? C.brass : C.sub,
              whiteSpace: 'nowrap', cursor: 'pointer', letterSpacing: '.01em',
              transition: 'color .15s, border-color .15s',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── Tab content ─────────────────────────────────────────────────────── */}
      <div role="tabpanel" style={{ padding: '0 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* OVERVIEW */}
        {tab === 'Overview' && <>
          <div style={grid2}>
            <Stat label="Uptime"          value="99.97" unit="%"   badge="30-day average"  badgeColor="green" />
            <Stat label="Requests / sec"  value="84"    unit="rps" badge="Stable range"    badgeColor="green" />
            <Stat label="Error rate"      value="0.3"   unit="%"   badge="Below 1% limit"  badgeColor="green" />
            <Stat label="P95 latency"     value="118"   unit="ms"  badge="Below 500ms"     badgeColor="green" />
          </div>
          <AreaPanel title="Request volume" sub="Requests per second · last 24 samples" data={MOCK_DATA.rps}  color={C.blue}  unit=" rps" />
          <MultiPanel title="Response time" series={[
            { key: 'p50', label: 'P50', data: MOCK_DATA.p50, color: C.green, unit: 'ms' },
            { key: 'p95', label: 'P95', data: MOCK_DATA.p95, color: C.brass, unit: 'ms' },
            { key: 'p99', label: 'P99', data: MOCK_DATA.p99, color: C.red,   unit: 'ms' },
          ]} />
        </>}

        {/* INFRASTRUCTURE */}
        {tab === 'Infrastructure' && <>
          <EmbedPanel
            title="CPU utilization" sub="Alert at 80% · last 24 samples"
            embedUrl={GRAFANA_PANELS.cpu}
            fallback={<div style={{ padding: '0 8px 10px' }}><AreaPanel title="" data={MOCK_DATA.cpu} color={C.blue} unit="%" domain={[0, 100]} /></div>}
          />
          <EmbedPanel
            title="Memory usage" sub="Alert at 85% · last 24 samples"
            embedUrl={GRAFANA_PANELS.memory}
            fallback={<div style={{ padding: '0 8px 10px' }}><AreaPanel title="" data={MOCK_DATA.mem} color="#9B7FE0" unit="%" domain={[0, 100]} /></div>}
          />
          <Card style={{ padding: '14px 16px' }}>
            <p style={{ fontSize: 12, fontWeight: 500, color: C.text, marginBottom: 14 }}>Disk usage</p>
            <DiskBar label="Root (/)"           pct={42} />
            <DiskBar label="Data (/var/lib/pg)" pct={61} />
            <DiskBar label="Logs (/var/log)"    pct={18} />
          </Card>
        </>}

        {/* DATABASE */}
        {tab === 'Database' && <>
          <div style={grid2}>
            <Stat label="Active connections" value="6"    unit="/ 10" badge="60% of pool" badgeColor="green" />
            <Stat label="Cache hit ratio"    value="97.2" unit="%"    badge="Healthy"     badgeColor="green" />
          </div>
          <EmbedPanel
            title="PG active connections" sub="Max pool: 10 · alert at 7"
            embedUrl={GRAFANA_PANELS.pgConn}
            fallback={<div style={{ padding: '0 8px 10px' }}><AreaPanel title="" data={MOCK_DATA.pgConn} color={C.blue} domain={[0, 10]} /></div>}
          />
          <EmbedPanel
            title="Cache hit ratio" sub="PostgreSQL shared buffers · alert below 95%"
            embedUrl={GRAFANA_PANELS.cacheHit}
            fallback={<div style={{ padding: '0 8px 10px' }}><AreaPanel title="" data={MOCK_DATA.cacheHit} color={C.green} unit="%" domain={[90, 100]} /></div>}
          />
          <Card style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
              <i className="ti ti-clock-exclamation" style={{ fontSize: 14, color: C.yellow }} aria-hidden="true" />
              <span style={{ fontSize: 12, fontWeight: 500, color: C.text }}>Recent slow queries</span>
              <span style={{ marginLeft: 'auto', fontSize: 10.5, padding: '2px 8px', borderRadius: 100, background: C.yellowF, color: C.yellow, fontWeight: 500 }}>
                3 today
              </span>
            </div>
            {[
              { q: 'SELECT * FROM student_sessions WHERE student_id = $1',          ms: '823ms', ago: '2m ago' },
              { q: 'UPDATE concept_store SET decay_score = $1 WHERE ...',            ms: '641ms', ago: '8m ago' },
              { q: 'SELECT agents.*, sessions.* FROM agents JOIN sessions ON ...',   ms: '512ms', ago: '19m ago' },
            ].map((row, i, arr) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 0', borderBottom: i < arr.length - 1 ? `1px solid ${C.b}` : 'none' }}>
                <span style={{ fontSize: 11, fontFamily: 'monospace', color: C.sub, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.q}
                </span>
                <span style={{ fontSize: 11, color: C.yellow, fontWeight: 600, whiteSpace: 'nowrap' }}>{row.ms}</span>
                <span style={{ fontSize: 11, color: C.dim, whiteSpace: 'nowrap' }}>{row.ago}</span>
              </div>
            ))}
          </Card>
        </>}

        {/* AI / LLM */}
        {tab === 'AI / LLM' && <>
          <div style={grid2}>
            <Stat label="Avg AI latency"  value="1.15" unit="s"  badge="GPT-4.1-mini"    badgeColor="brass" />
            <Stat label="AI calls / min"  value="11"              badge="3 agents active"  badgeColor="brass" />
            <Stat label="AI error rate"   value="0.0"  unit="%"  badge="No failures"      badgeColor="green" />
            <Stat label="Tokens / hour"   value="84k"             badge="Est. cost: ₦0.12" badgeColor="brass" />
          </div>
          <EmbedPanel
            title="Agent response latency" sub="OpenAI API · GPT-4.1-mini / GPT-4o"
            embedUrl={GRAFANA_PANELS.aiMs}
            fallback={<div style={{ padding: '0 8px 10px' }}><AreaPanel title="" data={MOCK_DATA.aiMs} color={C.brass} unit="ms" /></div>}
          />
          <EmbedPanel
            title="Agent calls / min" sub="NaNa Esumai · Sargeant · Prof. Ade"
            embedUrl={GRAFANA_PANELS.aiCalls}
            fallback={<div style={{ padding: '0 8px 10px' }}><AreaPanel title="" data={MOCK_DATA.aiCalls} color={C.blue} /></div>}
          />
          <Card style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
              <i className="ti ti-robot" style={{ fontSize: 14, color: C.sub }} aria-hidden="true" />
              <span style={{ fontSize: 12, fontWeight: 500, color: C.text }}>Agent activity log</span>
            </div>
            <div style={{ marginBottom: 12 }}>
              {Object.entries(AGENT_COLORS).map(([name, color]) => (
                <span key={name} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  fontSize: 10.5, padding: '2px 9px', borderRadius: 100, marginRight: 6, marginTop: 6,
                  background: C.brassF2, color, border: `1px solid ${C.b}`, fontWeight: 500,
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, flexShrink: 0 }} />
                  {name}
                </span>
              ))}
            </div>
            <AgentRow agent="NaNa Esumai" action="Biology: Cell Division — live session" ms="1,240ms" ago="1m ago" ok />
            <AgentRow agent="Sargeant"    action="Quiz evaluation — 8 answers scored"    ms="890ms"   ago="3m ago" ok />
            <AgentRow agent="Prof. Ade"   action="Concept decay update (12 concepts)"    ms="430ms"   ago="5m ago" ok />
            <AgentRow agent="NaNa Esumai" action="Mathematics: Algebra — live session"   ms="1,580ms" ago="9m ago" ok={false} />
          </Card>
        </>}

      </div>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <div style={{ margin: '20px 18px 0', paddingTop: 14, borderTop: `1px solid ${C.b}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 10.5, color: C.dim }}>Grafana Cloud · Mimir + Loki + Tempo</span>
        <a
          href="https://grafana.com"
          target="_blank"
          rel="noreferrer"
          style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: C.sub, textDecoration: 'none' }}
        >
          Open Grafana
          <i className="ti ti-external-link" style={{ fontSize: 11 }} aria-hidden="true" />
        </a>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 0.7s linear infinite; }
        ::-webkit-scrollbar { height: 3px; background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1A2E48; border-radius: 2px; }
      `}</style>

    </div>
  );
}

/**
 * USAGE
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Install recharts:   npm install recharts
 * 2. Install Tabler icons (for ti-* icon classes):
 *      npm install @tabler/icons-webfont
 *    Then import in your entry point:
 *      import '@tabler/icons-webfont/tabler-icons.min.css'
 *
 * 3. Add Inter to your project (or via Tailwind config if already set up):
 *      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
 *
 * 4. Mount in your admin router:
 *      import ObservabilityDashboard from './ObservabilityDashboard';
 *      <Route path="/admin/observability" element={<ObservabilityDashboard />} />
 *
 * 5. Wire up live Grafana embeds:
 *      Edit GRAFANA_PANELS at the top of this file.
 *      Each value should be the iframe src URL from Grafana Cloud
 *      (panel → Share → Embed → copy src).
 *      When a URL is present, the embed renders automatically.
 *      When empty, the chart uses mock data as a placeholder.
 *
 * 6. Replace MOCK_DATA with live API calls (Prometheus HTTP API or Grafana
 *    Cloud data source proxies) once your stack is set up.
 */
