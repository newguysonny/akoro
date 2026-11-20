import { Icon } from '../../../components/common/Icons.jsx';
import { BRAND } from '../../../constants.js';
import { APP_HOME } from '../../../config/target.js';
import { KINDS, TAB } from './libraryMeta.js';

export default function LibraryHeader({ navigate, t, items, recordsTotal, setAddOpen, filter, setFilter, q, setQ, setQLimit }) {
  return (
      <div style={{ background: 'var(--ak-surface)', backdropFilter: 'blur(14px)', borderBottom: '1px solid var(--ak-border)', padding: '14px 18px', zIndex: 100, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => navigate(APP_HOME)}
              style={{ background: '#F0EBFF', border: '1px solid #DDD3FF', borderRadius: 100, width: 34, height: 34, cursor: 'pointer', color: BRAND, fontSize: 16, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              ‹
            </button>
            <div>
              <p style={{ fontSize: 16, fontWeight: 900, color: 'var(--ak-text)', margin: 0 }}>Library</p>
              <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ak-text-muted)', margin: 0 }}>
                {items.length + recordsTotal > 0 ? `${items.length + recordsTotal} saved` : 'Your shelf is empty'}
              </p>
            </div>
          </div>
          {/* Plus — choose: upload a record or (higher-ed) write a blog */}
          <button onClick={() => setAddOpen(true)} aria-label={t('records.title')} title={t('records.title')}
            style={{ background: BRAND, border: 'none', borderRadius: 100, width: 34, height: 34, cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name="ti-plus" size={18}/>
          </button>
        </div>

        {/* Pills — scrollable area of library kinds */}
        <div style={{ display: 'flex', gap: 6, marginTop: 12, overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
          {KINDS.map(k => <button key={k.key} style={TAB(filter === k.key)} onClick={() => setFilter(k.key)}>{k.label}</button>)}
        </div>

        {/* Search — finds what your records SAY, not just what they're named */}
        <div style={{ position: 'relative', marginTop: 10 }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', display: 'flex', color: 'var(--ak-text-muted)' }}>
            <Icon name="ti-search" size={14} />
          </span>
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setQLimit(12); }}
            placeholder="Search inside your records…"
            aria-label="Search your library"
            style={{ width: '100%', boxSizing: 'border-box', padding: '9px 34px 9px 33px', borderRadius: 100,
              border: '1px solid var(--ak-border)', background: 'var(--ak-bg)', color: 'var(--ak-text)',
              fontFamily: "'Nunito',sans-serif", fontSize: 12.5, fontWeight: 700, outline: 'none' }}
          />
          {q && (
            <button onClick={() => setQ('')} aria-label="Clear search"
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'var(--ak-border)',
                border: 'none', borderRadius: 100, width: 20, height: 20, cursor: 'pointer', color: 'var(--ak-text-muted)',
                fontSize: 11, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>×</button>
          )}
        </div>
      </div>
  );
}
