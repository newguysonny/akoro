/**
 * AnalyticsPage — constants + child components.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { TrendingUp, DollarSign, Users, BookOpen, RefreshCw, Clock, CheckSquare, BarChart2 } from 'lucide-react';
import { PageLayout } from '../../components/Layout.jsx';
import { Skeleton, Toast } from '../../components/Primitives.jsx';
import { apiGet } from '../../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, PURPLE, FONT } from '../../constants.js';


const PERIODS = ['7d', '30d', '90d', '1y'];

function StatCard({ icon: Icon, label, value, sub, color = AMBER, loading }) {
  if (loading) return (
    <div style={{ background: WHITE, borderRadius: 16, padding: 20, border: `1px solid ${BORDER}` }}>
      <Skeleton height={14} width={80} style={{ marginBottom: 12 }} />
      <Skeleton height={32} width={60} style={{ marginBottom: 6 }} />
      <Skeleton height={12} width={100} />
    </div>
  );
  return (
    <div style={{
      background: WHITE, borderRadius: 16, padding: 20,
      border: `1px solid ${BORDER}`, display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: `${color}15`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={18} color={color} />
        </div>
        <span style={{ fontSize: 12, color: MUTED, fontWeight: 500, fontFamily: FONT }}>{label}</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: INK, fontFamily: FONT, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: MUTED, fontFamily: FONT }}>{sub}</div>}
    </div>
  );
}

function BarChart({ data, loading }) {
  const [tooltip, setTooltip] = useState(null);
  const svgRef = useRef(null);

  if (loading) return <Skeleton height={200} style={{ borderRadius: 12 }} />;
  if (!data || data.length === 0) return (
    <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED, fontSize: 13, fontFamily: FONT }}>
      No revenue data available
    </div>
  );

  const maxVal = Math.max(...data.map(d => d.amount || 0), 1);
  const barW = Math.max(4, Math.floor(600 / data.length) - 2);
  const gap = Math.max(2, Math.floor(600 / data.length) - barW);
  const totalW = data.length * (barW + gap);
  const chartH = 160;

  return (
    <div style={{ position: 'relative', width: '100%', overflowX: 'auto' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${Math.max(totalW, 600)} ${chartH + 30}`}
        style={{ width: '100%', height: 200, display: 'block' }}
        onMouseLeave={() => setTooltip(null)}
      >
        {data.map((d, i) => {
          const h = Math.max(2, ((d.amount || 0) / maxVal) * chartH);
          const x = i * (barW + gap);
          const y = chartH - h;
          return (
            <g key={i}>
              <rect
                x={x} y={y} width={barW} height={h}
                fill={AMBER} rx={3}
                style={{ cursor: 'pointer', transition: 'opacity .1s' }}
                onMouseEnter={(e) => {
                  const rect = svgRef.current?.getBoundingClientRect();
                  setTooltip({
                    date: d.date,
                    amount: d.amount,
                    x: rect ? (x / Math.max(totalW, 600)) * rect.width + rect.left : e.clientX,
                    y: rect ? rect.top + y - 10 : e.clientY,
                  });
                }}
                onMouseLeave={() => setTooltip(null)}
              />
            </g>
          );
        })}
        {data.filter((_, i) => i % Math.ceil(data.length / 10) === 0).map((d, labelIdx) => {
          const i = data.indexOf(d);
          const x = i * (barW + gap) + barW / 2;
          return (
            <text key={labelIdx} x={x} y={chartH + 18} textAnchor="middle"
              style={{ fontSize: 9, fill: MUTED2, fontFamily: FONT }}>
              {d.date ? d.date.slice(5) : ''}
            </text>
          );
        })}
      </svg>
      {tooltip && (
        <div style={{
          position: 'fixed', top: tooltip.y, left: tooltip.x,
          background: INK, color: WHITE, padding: '6px 10px', borderRadius: 8,
          fontSize: 12, fontFamily: FONT, pointerEvents: 'none', zIndex: 999,
          transform: 'translate(-50%, -100%)',
          whiteSpace: 'nowrap',
        }}>
          <div style={{ fontWeight: 700 }}>{tooltip.date}</div>
          <div>${(tooltip.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        </div>
      )}
    </div>
  );
}


export { PERIODS, StatCard, BarChart };
