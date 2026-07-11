/**
 * UsersPage — constants + child components.
 */
import { useState, useEffect, useCallback } from 'react';
import { Users, Search, UserX, UserCheck, Trash2, LogOut, UserPlus, Upload, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PageLayout } from '../../components/Layout.jsx';
import { Btn, Modal, Toast, Skeleton, Inp } from '../../components/Primitives.jsx';
import useAdminAPI from '../../hooks/useAdminAPI.js';
import { apiGet, apiPost } from '../../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, PURPLE, FONT } from '../../constants.js';


function RolePill({ role }) {
  const map = {
    student:    { bg: '#EDE9FF', color: PURPLE },
    instructor: { bg: '#FFF3DC', color: AMBER },
    admin:      { bg: '#FFE4E4', color: RED },
  };
  const cfg = map[role] || map.student;
  return (
    <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: cfg.bg, color: cfg.color }}>
      {role}
    </span>
  );
}

function StatusPill({ active }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
      background: active ? '#DCFCE7' : '#FEE2E2',
      color: active ? GREEN : RED,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: active ? GREEN : RED, display: 'inline-block' }} />
      {active ? 'Active' : 'Suspended'}
    </span>
  );
}

function UserDrawer({ user, onClose }) {
  const [enrollments, setEnrollments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    apiGet(`/api/admin/users/${user.id}/enrollments`)
      .then(res => setEnrollments(Array.isArray(res) ? res : (res?.enrollments || res?.data || [])))
      .catch(() => setEnrollments([]))
      .finally(() => setLoading(false));
  }, [user]);

  if (!user) return null;

  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  return (
    <>
      {/* overlay */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(26,26,46,.35)',
          zIndex: 900, backdropFilter: 'blur(2px)',
        }}
      />
      {/* drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 400,
        background: WHITE, zIndex: 901, boxShadow: '-8px 0 40px rgba(0,0,0,.15)',
        display: 'flex', flexDirection: 'column', overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: INK, fontFamily: FONT, margin: 0 }}>User Profile</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: MUTED }}>
            <X size={18} />
          </button>
        </div>

        {/* User info */}
        <div style={{ padding: '24px', borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              background: `${AMBER}20`, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, fontWeight: 700, color: AMBER, flexShrink: 0,
            }}>
              {(user.full_name || user.fullName || user.username || '?')[0].toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: INK, fontFamily: FONT }}>
                {user.full_name || user.fullName || user.username || '—'}
              </div>
              <div style={{ fontSize: 13, color: MUTED, fontFamily: FONT }}>{user.email}</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { label: 'Role',    value: <RolePill role={user.role} /> },
              { label: 'Status',  value: <StatusPill active={user.is_active !== false} /> },
              { label: 'Joined',  value: fmtDate(user.created_at) },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: MUTED, fontFamily: FONT }}>{label}</span>
                <span style={{ fontSize: 13, color: INK, fontFamily: FONT }}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Enrollments */}
        <div style={{ padding: '20px 24px', flex: 1 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: INK, fontFamily: FONT, margin: '0 0 14px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Enrollment History
          </h3>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[1,2,3].map(i => <Skeleton key={i} height={56} />)}
            </div>
          ) : enrollments.length === 0 ? (
            <p style={{ fontSize: 13, color: MUTED, fontFamily: FONT }}>No enrollments yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {enrollments.map((enr, idx) => {
                const progress = enr.progress || enr.completion_percentage || 0;
                return (
                  <div key={enr.id || idx} style={{
                    background: LIGHT, borderRadius: 10, padding: '12px 14px',
                    border: `1px solid ${BORDER}`,
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: INK, fontFamily: FONT, marginBottom: 6 }}>
                      {enr.course_title || enr.course?.title || '—'}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 6, background: `${BORDER}`, borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ width: `${Math.min(100, progress)}%`, height: '100%', background: GREEN, borderRadius: 4, transition: 'width .3s' }} />
                      </div>
                      <span style={{ fontSize: 11, color: MUTED, fontFamily: FONT, flexShrink: 0 }}>
                        {Math.round(progress)}%
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: MUTED2, fontFamily: FONT, marginTop: 4 }}>
                      Enrolled {fmtDate(enr.enrolled_at || enr.created_at)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const PAGE_SIZE = 20;


export { RolePill, StatusPill, UserDrawer, PAGE_SIZE };
