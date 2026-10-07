import { useState, useEffect, useCallback } from 'react';
import { Search, Mail, Archive, CheckCheck } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Toast, Skeleton } from '../components/Primitives.jsx';
import { apiGet, apiPatch } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, FONT } from '../constants.js';

const KIND_TABS   = [['all', 'All'], ['contact', 'Contact'], ['partner', 'Partners']];
const STATUS_TABS = [['all', 'All'], ['new', 'New'], ['read', 'Read'], ['archived', 'Archived']];

const STATUS_STYLE = {
  new:      { bg: '#EEF2FF', fg: '#4338CA', label: 'New' },
  read:     { bg: '#ECFDF5', fg: '#047857', label: 'Read' },
  archived: { bg: '#F3F4F6', fg: MUTED,     label: 'Archived' },
};

export default function MessagesPage() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [kind, setKind]         = useState('all');
  const [status, setStatus]     = useState('all');
  const [search, setSearch]     = useState('');
  const [open, setOpen]         = useState(null);   // message being viewed
  const [busy, setBusy]         = useState(null);
  const [toast, setToast]       = useState(null);

  const showToast = (message, type = 'success') => { setToast({ message, type }); setTimeout(() => setToast(null), 3500); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: 300 });
      if (kind   !== 'all') params.set('kind', kind);
      if (status !== 'all') params.set('status', status);
      const res = await apiGet(`/api/contact/messages?${params}`);
      setMessages(Array.isArray(res) ? res : (res?.data || res?.messages || []));
    } catch (err) {
      showToast(err.message || 'Failed to load messages', 'error');
    } finally {
      setLoading(false);
    }
  }, [kind, status]);

  useEffect(() => { load(); }, [load]);

  const setMsgStatus = async (id, next) => {
    setBusy(id);
    try {
      await apiPatch(`/api/contact/messages/${id}`, { status: next });
      setMessages(prev => prev.map(m => m.id === id ? { ...m, status: next } : m));
      if (open?.id === id) setOpen(o => ({ ...o, status: next }));
      showToast(next === 'archived' ? 'Archived' : 'Marked as read');
    } catch (err) {
      showToast(err.message || 'Update failed', 'error');
    } finally {
      setBusy(null);
    }
  };

  const openMessage = (m) => {
    setOpen(m);
    if (m.status === 'new') setMsgStatus(m.id, 'read');
  };

  const filtered = messages.filter(m => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return [m.name, m.email, m.organisation, m.subject, m.message]
      .some(v => (v || '').toLowerCase().includes(q));
  });

  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const truncate = (s, n = 90) => s && s.length > n ? s.slice(0, n) + '…' : (s || '—');

  const TH = { fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', padding: '10px 14px', textAlign: 'left', fontFamily: FONT };
  const TD = { fontSize: 13, color: INK, padding: '13px 14px', fontFamily: FONT, borderBottom: `1px solid ${BORDER}` };
  const chip = (active) => ({ padding: '6px 16px', borderRadius: 20, border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: active ? 700 : 500, background: active ? AMBER : 'transparent', color: active ? WHITE : MUTED, transition: 'all .15s' });
  const kindBadge = (k) => k === 'partner'
    ? { bg: '#F5F3FF', fg: '#6C3BFF', label: 'Partner' }
    : { bg: '#FFF7ED', fg: '#B45309', label: 'Contact' };

  return (
    <PageLayout title="Messages" subtitle={`${filtered.length} message${filtered.length === 1 ? '' : 's'}`}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={15} color={MUTED} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email, message…"
              style={{ width: '100%', padding: '10px 14px 10px 36px', borderRadius: 10, border: `1.5px solid ${BORDER}`, outline: 'none', fontSize: 13, fontFamily: FONT, color: INK, background: WHITE, boxSizing: 'border-box' }} />
          </div>
          <div style={{ display: 'flex', gap: 4, background: LIGHT, borderRadius: 22, padding: 3 }}>
            {KIND_TABS.map(([v, l]) => <button key={v} style={chip(kind === v)} onClick={() => setKind(v)}>{l}</button>)}
          </div>
          <div style={{ display: 'flex', gap: 4, background: LIGHT, borderRadius: 22, padding: 3 }}>
            {STATUS_TABS.map(([v, l]) => <button key={v} style={chip(status === v)} onClick={() => setStatus(v)}>{l}</button>)}
          </div>
        </div>

        {/* Table */}
        <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, overflow: 'hidden', overflowX: 'auto' }}>
          {loading ? (
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[1,2,3,4,5,6].map(i => <Skeleton key={i} height={52} />)}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 880 }}>
              <thead>
                <tr style={{ background: LIGHT }}>
                  <th style={TH}>Type</th>
                  <th style={TH}>From</th>
                  <th style={TH}>Organisation</th>
                  <th style={TH}>Subject</th>
                  <th style={TH}>Message</th>
                  <th style={TH}>Date</th>
                  <th style={{ ...TH, textAlign: 'center' }}>Status</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={8} style={{ ...TD, textAlign: 'center', color: MUTED, borderBottom: 'none' }}>No messages found</td></tr>
                ) : filtered.map(m => {
                  const kb = kindBadge(m.kind);
                  const sb = STATUS_STYLE[m.status] || STATUS_STYLE.new;
                  const rowBg = m.status === 'new' ? '#FCFCFF' : WHITE;
                  return (
                    <tr key={m.id} onClick={() => openMessage(m)}
                      onMouseEnter={e => e.currentTarget.style.background = '#FAF8F5'}
                      onMouseLeave={e => e.currentTarget.style.background = rowBg}
                      style={{ background: rowBg, cursor: 'pointer' }}>
                      <td style={TD}><span style={{ background: kb.bg, color: kb.fg, padding: '2px 9px', borderRadius: 12, fontSize: 11, fontWeight: 700 }}>{kb.label}</span></td>
                      <td style={TD}><div style={{ fontWeight: 600 }}>{m.name}</div><div style={{ fontSize: 11, color: MUTED }}>{m.email}</div></td>
                      <td style={{ ...TD, color: MUTED }}>{m.organisation || '—'}</td>
                      <td style={{ ...TD, maxWidth: 140 }}><span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.subject || '—'}</span></td>
                      <td style={{ ...TD, maxWidth: 240, color: MUTED }}>{truncate(m.message)}</td>
                      <td style={{ ...TD, color: MUTED, whiteSpace: 'nowrap' }}>{fmtDate(m.created_at)}</td>
                      <td style={{ ...TD, textAlign: 'center' }}><span style={{ background: sb.bg, color: sb.fg, padding: '2px 9px', borderRadius: 12, fontSize: 11, fontWeight: 700 }}>{sb.label}</span></td>
                      <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                        {m.status !== 'read' && m.status !== 'archived' && (
                          <button title="Mark read" disabled={busy === m.id} onClick={() => setMsgStatus(m.id, 'read')}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: GREEN, padding: 6 }}><CheckCheck size={16} /></button>
                        )}
                        {m.status !== 'archived' && (
                          <button title="Archive" disabled={busy === m.id} onClick={() => setMsgStatus(m.id, 'archived')}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED2, padding: 6 }}><Archive size={16} /></button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Detail drawer */}
      {open && (
        <>
          <div onClick={() => setOpen(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,10,30,.4)', zIndex: 200 }} />
          <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(92vw,460px)', background: WHITE, zIndex: 201, boxShadow: '-8px 0 40px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', fontFamily: FONT }}>
            <div style={{ padding: '18px 22px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}><Mail size={18} color={AMBER} /><span style={{ fontWeight: 800, fontSize: 16, color: INK }}>{kindBadge(open.kind).label} message</span></div>
              <button onClick={() => setOpen(null)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: MUTED, lineHeight: 1 }}>×</button>
            </div>
            <div style={{ padding: '20px 22px', overflowY: 'auto', flex: 1 }}>
              {[['From', open.name], ['Email', open.email], ['Organisation', open.organisation || '—'], ['Subject', open.subject || '—'], ['Received', fmtDate(open.created_at)]].map(([k, v]) => (
                <div key={k} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', marginBottom: 3 }}>{k}</div>
                  <div style={{ fontSize: 14, color: INK, wordBreak: 'break-word' }}>{v}</div>
                </div>
              ))}
              <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', marginBottom: 6 }}>Message</div>
              <div style={{ fontSize: 14, color: INK, lineHeight: 1.7, whiteSpace: 'pre-wrap', background: LIGHT, borderRadius: 12, padding: '14px 16px' }}>{open.message}</div>
            </div>
            <div style={{ padding: '14px 22px', borderTop: `1px solid ${BORDER}`, display: 'flex', gap: 10 }}>
              <a href={`mailto:${open.email}?subject=Re: ${encodeURIComponent(open.subject || 'Your message to Akoro')}`}
                style={{ flex: 1, textAlign: 'center', padding: '11px', borderRadius: 10, background: AMBER, color: WHITE, fontWeight: 700, fontSize: 14, textDecoration: 'none' }}>Reply by email</a>
              {open.status !== 'archived' && (
                <button onClick={() => setMsgStatus(open.id, 'archived')} disabled={busy === open.id}
                  style={{ padding: '11px 16px', borderRadius: 10, background: WHITE, color: MUTED, border: `1.5px solid ${BORDER}`, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Archive</button>
              )}
            </div>
          </div>
        </>
      )}

      {toast && <Toast message={toast.message} type={toast.type} />}
    </PageLayout>
  );
}
