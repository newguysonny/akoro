/**
 * StudentsPage — constants + child components.
 */
import { useState, useEffect, useRef } from 'react';
import {
  Search, Plus, X, User, Mail, Calendar, BookOpen, TrendingUp,
  Trash2, ChevronRight, Copy, Check, Upload, Link2, UserPlus,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../components/Layout.jsx';
import { Btn, Modal, Inp, StatusPill, Toast } from '../../components/Primitives.jsx';
import { useStudentsAPI } from '../../hooks/useStudentsAPI.js';
import { useCoursesAPI }  from '../../hooks/useCoursesAPI.js';
import {
  AMBER, INK, MUTED, BORDER, LIGHT, WHITE, GREEN, PURPLE, BLUE, RED, FONT,
} from '../../constants.js';

/* ── Enrol Modal — tabs: Manual | Invite Link | Bulk CSV ─────────────── */

function EnrolModal({ open, onClose, onDone, courses = [] }) {
  const { addStudent, generateInvite, importCSV } = useStudentsAPI();
  const [tab, setTab]       = useState('manual');
  const [loading, setLoad]  = useState(false);
  const [error, setError]   = useState('');
  const [success, setOk]    = useState('');
  const fileRef = useRef(null);

  // Manual form
  const [manual, setManual] = useState({ email: '', fullName: '', courseIds: [] });
  const setM = (k, v) => setManual(f => ({ ...f, [k]: v }));
  const toggleManualCourse = (id) =>
    setManual(f => ({ ...f, courseIds: f.courseIds.includes(id) ? f.courseIds.filter(x => x !== id) : [...f.courseIds, id] }));
  const toggleAllManualCourses = () =>
    setManual(f => ({ ...f, courseIds: f.courseIds.length === courses.length ? [] : courses.map(c => c.id) }));

  // Invite form
  const [inv, setInv]       = useState({ courseIds: [], expiresInDays: 7, emails: '' });
  const setI = (k, v) => setInv(f => ({ ...f, [k]: v }));
  const toggleInvCourse = (id) =>
    setInv(f => ({ ...f, courseIds: f.courseIds.includes(id) ? f.courseIds.filter(x => x !== id) : [...f.courseIds, id] }));
  const toggleAllInvCourses = () =>
    setInv(f => ({ ...f, courseIds: f.courseIds.length === courses.length ? [] : courses.map(c => c.id) }));
  const [inviteUrl, setUrl] = useState('');
  const [copied, setCopied] = useState(false);

  // CSV form
  const [csv, setCsv]       = useState({ courseId: '', file: null });
  const [csvResult, setCsvR] = useState(null);

  useEffect(() => {
    if (open) {
      setTab('manual'); setLoad(false); setError(''); setOk('');
      setManual({ email: '', fullName: '', courseIds: [] });
      setInv({ courseIds: [], expiresInDays: 7, emails: '' });
      setUrl(''); setCopied(false);
      setCsv({ courseId: '', file: null }); setCsvR(null);
    }
  }, [open]);

  const reset = () => { setError(''); setOk(''); };

  /* Manual submit */
  const submitManual = async (e) => {
    e.preventDefault(); reset();
    if (!manual.email)              { setError('Email is required'); return; }
    if (!manual.courseIds.length)   { setError('Please select at least one course'); return; }
    setLoad(true);
    const errors = [];
    for (const courseId of manual.courseIds) {
      try {
        await addStudent({ email: manual.email, fullName: manual.fullName, courseId });
      } catch (err) { errors.push(err.message); }
    }
    setLoad(false);
    if (errors.length === manual.courseIds.length) {
      setError(errors[0] || 'Failed to add student');
    } else {
      const n = manual.courseIds.length - errors.length;
      setOk(`Student added to ${n} course${n > 1 ? 's' : ''}! They'll receive a welcome email to set their password.${errors.length ? ` (${errors.length} skipped: ${errors[0]})` : ''}`);
      onDone?.();
    }
  };

  /* Invite link generate */
  const submitInvite = async (e) => {
    e.preventDefault(); reset();
    if (!inv.courseIds.length) { setError('Please select at least one course'); return; }
    setLoad(true);
    try {
      const emailList = inv.emails.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
      const res = await generateInvite({
        courseIds: inv.courseIds,
        expiresInDays: Number(inv.expiresInDays) || 7,
        emails: emailList,
      });
      // Response is wrapped as { success, data: { invite_url, ... } }.
      const url = res.data?.invite_url || res.invite_url || res.inviteUrl || '';
      setUrl(url);
      if (!url) { setError('Could not generate link. Please try again.'); return; }
      if (emailList.length) setOk(`Invite sent to ${emailList.length} email(s).`);
    } catch (err) {
      setError(err.message || 'Failed to generate invite');
    } finally { setLoad(false); }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  /* CSV submit */
  const submitCSV = async (e) => {
    e.preventDefault(); reset();
    if (!csv.file)     { setError('Please choose a CSV file'); return; }
    if (!csv.courseId) { setError('Please select a course'); return; }
    setLoad(true);
    try {
      const result = await importCSV(csv.file, csv.courseId);
      setCsvR(result);
      onDone?.();
    } catch (err) {
      setError(err.message || 'Import failed');
    } finally { setLoad(false); }
  };

  const TAB_STYLE = (active) => ({
    flex: 1, padding: '8px 4px', border: 'none', borderRadius: 8,
    background: active ? WHITE : 'transparent',
    color: active ? AMBER : MUTED, fontWeight: active ? 700 : 500,
    fontSize: 12, fontFamily: FONT, cursor: 'pointer',
    boxShadow: active ? `0 1px 4px ${AMBER}22` : 'none',
    transition: 'all .15s',
  });

  const CourseChecklist = ({ selected, onToggle, onToggleAll }) => (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <label style={{ fontSize: 12, fontWeight: 700, color: INK, fontFamily: FONT }}>
          Enrol in Course(s) *
        </label>
        <button
          type="button"
          onClick={onToggleAll}
          style={{ fontSize: 11, color: AMBER, background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT, fontWeight: 700 }}
        >
          {selected.length === courses.length && courses.length > 0 ? 'Deselect all' : 'All courses'}
        </button>
      </div>
      <div style={{
        border: `1.5px solid ${BORDER}`, borderRadius: 10, padding: 8,
        maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4,
        background: WHITE,
      }}>
        {courses.length === 0 && (
          <div style={{ fontSize: 12, color: MUTED, padding: '6px 4px', fontFamily: FONT }}>No courses yet — create one first.</div>
        )}
        {courses.map(c => (
          <label key={c.id} style={{
            display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
            fontSize: 13, color: INK, fontFamily: FONT, padding: '5px 4px', borderRadius: 6,
          }}>
            <input
              type="checkbox"
              checked={selected.includes(c.id)}
              onChange={() => onToggle(c.id)}
              style={{ accentColor: AMBER, width: 15, height: 15 }}
            />
            {c.title}
          </label>
        ))}
      </div>
    </div>
  );

  const CourseSelect = ({ value, onChange }) => (
    <div>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: INK, marginBottom: 6, fontFamily: FONT }}>
        Enrol in Course *
      </label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', padding: '10px 12px', borderRadius: 10,
          border: `1.5px solid ${BORDER}`, fontFamily: FONT, fontSize: 13,
          color: value ? INK : MUTED, background: WHITE, outline: 'none',
        }}
      >
        <option value="">— Select a course —</option>
        {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
      </select>
    </div>
  );

  const Feedback = () => (
    <>
      {error && (
        <div style={{ background: '#FEF2F2', border: `1px solid #FECACA`, borderRadius: 10, padding: '10px 14px', fontSize: 13, color: RED }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ background: '#F0FDF4', border: `1px solid #BBF7D0`, borderRadius: 10, padding: '10px 14px', fontSize: 13, color: GREEN }}>
          {success}
        </div>
      )}
    </>
  );

  return (
    <Modal open={open} onClose={onClose} title="Add a Student">
      {/* Tab bar */}
      <div style={{ display: 'flex', background: LIGHT, borderRadius: 10, padding: 4, marginBottom: 20, gap: 2 }}>
        <button style={TAB_STYLE(tab === 'manual')} onClick={() => { setTab('manual'); reset(); }}>
          ✏️ Manual Entry
        </button>
        <button style={TAB_STYLE(tab === 'invite')} onClick={() => { setTab('invite'); reset(); }}>
          📧 Invite Link
        </button>
        <button style={TAB_STYLE(tab === 'csv')} onClick={() => { setTab('csv'); reset(); }}>
          📋 Bulk CSV
        </button>
      </div>

      {/* ── Manual ── */}
      {tab === 'manual' && (
        <form onSubmit={submitManual} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Feedback />
          <Inp
            label="Student Email *"
            type="email"
            value={manual.email}
            onChange={e => setM('email', e.target.value)}
            placeholder="student@example.com"
          />
          <Inp
            label="Full Name (optional)"
            value={manual.fullName}
            onChange={e => setM('fullName', e.target.value)}
            placeholder="Jane Doe"
          />
          <CourseChecklist selected={manual.courseIds} onToggle={toggleManualCourse} onToggleAll={toggleAllManualCourses} />
          <p style={{ fontSize: 12, color: MUTED, margin: 0 }}>
            If the student doesn't have an Akoro account yet, one will be created automatically
            and they can set their password via the welcome email.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <Btn variant="secondary" type="button" onClick={onClose}>Cancel</Btn>
            <Btn type="submit" disabled={loading}>{loading ? 'Adding…' : 'Add Student'}</Btn>
          </div>
        </form>
      )}

      {/* ── Invite Link ── */}
      {tab === 'invite' && (
        <form onSubmit={submitInvite} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Feedback />
          <CourseChecklist selected={inv.courseIds} onToggle={toggleInvCourse} onToggleAll={toggleAllInvCourses} />

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: INK, marginBottom: 6, fontFamily: FONT }}>
              Link Expires In
            </label>
            <select
              value={inv.expiresInDays}
              onChange={e => setI('expiresInDays', e.target.value)}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 10,
                border: `1.5px solid ${BORDER}`, fontFamily: FONT, fontSize: 13,
                color: INK, background: WHITE, outline: 'none',
              }}
            >
              <option value={1}>1 day</option>
              <option value={3}>3 days</option>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
            </select>
          </div>

          <Inp
            label="Also email the link to (optional)"
            type="text"
            value={inv.emails}
            onChange={e => setI('emails', e.target.value)}
            placeholder="alice@example.com, bob@example.com"
          />

          {inviteUrl && (
            <div style={{
              background: LIGHT, border: `1.5px solid ${BORDER}`, borderRadius: 10,
              padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <Link2 size={14} color={AMBER} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 11, color: INK, fontFamily: FONT, wordBreak: 'break-all' }}>
                {inviteUrl}
              </span>
              <button
                type="button"
                onClick={copyLink}
                style={{
                  background: copied ? GREEN : AMBER, border: 'none', borderRadius: 7,
                  padding: '6px 10px', cursor: 'pointer', color: WHITE,
                  display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontFamily: FONT,
                }}
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          )}

          <p style={{ fontSize: 12, color: MUTED, margin: 0 }}>
            Anyone with this link can join the selected course(s). Share it in a WhatsApp group, email, or anywhere.
          </p>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <Btn variant="secondary" type="button" onClick={onClose}>Close</Btn>
            <Btn type="submit" disabled={loading}>{loading ? 'Generating…' : inviteUrl ? 'Regenerate Link' : 'Generate Link'}</Btn>
          </div>
        </form>
      )}

      {/* ── Bulk CSV ── */}
      {tab === 'csv' && (
        <form onSubmit={submitCSV} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Feedback />

          <CourseSelect value={csv.courseId} onChange={v => setCsv(f => ({ ...f, courseId: v }))} />

          {/* Drop zone */}
          <div
            onClick={() => fileRef.current?.click()}
            style={{
              border: `2px dashed ${csv.file ? AMBER : BORDER}`, borderRadius: 12,
              padding: '24px', textAlign: 'center', cursor: 'pointer',
              background: csv.file ? `${AMBER}08` : LIGHT, transition: 'all .15s',
            }}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) setCsv(c => ({ ...c, file: f }));
            }}
          >
            <Upload size={22} color={csv.file ? AMBER : MUTED} style={{ marginBottom: 8 }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: csv.file ? AMBER : INK, fontFamily: FONT }}>
              {csv.file ? csv.file.name : 'Drop CSV file here or click to browse'}
            </div>
            {csv.file && (
              <div style={{ fontSize: 11, color: MUTED, marginTop: 4, fontFamily: FONT }}>
                {(csv.file.size / 1024).toFixed(1)} KB
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={e => setCsv(c => ({ ...c, file: e.target.files?.[0] || null }))}
            />
          </div>

          <div style={{ background: LIGHT, borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: INK, marginBottom: 4, fontFamily: FONT }}>
              CSV format — one student per row:
            </div>
            <code style={{ fontSize: 11, color: MUTED, fontFamily: 'monospace' }}>
              name,email,phone<br />
              Jane Doe,jane@example.com,+2348012345678<br />
              John Smith,john@example.com,
            </code>
          </div>

          {csvResult && (
            <div style={{ background: '#F0FDF4', border: `1px solid #BBF7D0`, borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: GREEN, marginBottom: 6, fontFamily: FONT }}>
                Import complete
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {[
                  { label: 'New accounts', value: csvResult.accounts_created ?? 0 },
                  { label: 'Already existed', value: csvResult.already_existed ?? 0 },
                  { label: 'Enrolled', value: (csvResult.accounts_created ?? 0) + (csvResult.already_existed ?? 0) },
                  { label: 'Failed rows', value: csvResult.failed ?? 0, warn: true },
                ].map(({ label, value, warn }) => (
                  <div key={label} style={{ fontSize: 12, color: warn && value ? RED : INK, fontFamily: FONT }}>
                    <span style={{ fontWeight: 700 }}>{value}</span> {label}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <Btn variant="secondary" type="button" onClick={onClose}>Close</Btn>
            <Btn type="submit" disabled={loading || !!csvResult}>
              {loading ? 'Importing…' : 'Import Students'}
            </Btn>
          </div>
        </form>
      )}
    </Modal>
  );
}

/* ── Student detail sheet ───────────────────────────────────────────── */
function StudentSheet({ student, courses = [], onClose, onRemove }) {
  const { addStudent } = useStudentsAPI();
  const [enrolCourses, setEnrolCourses] = useState([]);
  const [enrolLoading, setEnrolLoad]    = useState(false);
  const [enrolOk, setEnrolOk]           = useState('');

  useEffect(() => { if (student) { setEnrolCourses([]); setEnrolOk(''); } }, [student]);

  if (!student) return null;

  const toggleCourse = (id) =>
    setEnrolCourses(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const toggleAll = () =>
    setEnrolCourses(prev => prev.length === courses.length ? [] : courses.map(c => c.id));

  const handleEnrolInCourse = async () => {
    if (!enrolCourses.length) return;
    setEnrolLoad(true);
    const errors = [];
    for (const courseId of enrolCourses) {
      try { await addStudent({ email: student.email, courseId }); }
      catch (err) { errors.push(err.message); }
    }
    setEnrolLoad(false);
    if (errors.length === enrolCourses.length) {
      setEnrolOk('Error: ' + errors[0]);
    } else {
      const enrolled = enrolCourses.length - errors.length;
      setEnrolOk(`Enrolled in ${enrolled} course${enrolled > 1 ? 's' : ''}!`);
      setEnrolCourses([]);
      window.dispatchEvent(new Event('akoro:notifications-changed'));
      setTimeout(() => setEnrolOk(''), 3000);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(26,26,46,.3)', zIndex: 200, display: 'flex', justifyContent: 'flex-end' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 360, height: '100vh', background: WHITE, boxShadow: '-8px 0 40px rgba(0,0,0,.12)',
          padding: '24px', overflowY: 'auto', animation: 'sheet-up .25s ease both',
          display: 'flex', flexDirection: 'column', gap: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: INK, margin: 0, fontFamily: FONT }}>Student Profile</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED }}>
            <X size={18} />
          </button>
        </div>

        {/* Avatar + name */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '20px', background: LIGHT, borderRadius: 16 }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            background: `linear-gradient(135deg, ${AMBER}, ${PURPLE})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 24, color: WHITE, fontWeight: 700,
          }}>
            {(student.fullName || student.email || '?')[0].toUpperCase()}
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: INK, fontFamily: FONT }}>{student.fullName || 'Unknown'}</div>
            <div style={{ fontSize: 13, color: MUTED, fontFamily: FONT }}>{student.email}</div>
          </div>
          <StatusPill status={student.status} />
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {[
            { label: 'Courses', value: student.coursesEnrolled || 0, icon: BookOpen, color: BLUE },
            { label: 'Progress', value: `${student.progress || 0}%`, icon: TrendingUp, color: GREEN },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} style={{ background: LIGHT, borderRadius: 12, padding: '14px', textAlign: 'center' }}>
              <Icon size={18} color={color} style={{ marginBottom: 6 }} />
              <div style={{ fontSize: 20, fontWeight: 800, color: INK, fontFamily: FONT }}>{value}</div>
              <div style={{ fontSize: 11, color: MUTED, fontFamily: FONT }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Details */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Mail size={14} color={MUTED} />
            <span style={{ fontSize: 13, color: MUTED, fontFamily: FONT }}>{student.email}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Calendar size={14} color={MUTED} />
            <span style={{ fontSize: 13, color: MUTED, fontFamily: FONT }}>
              Joined {student.joinedAt ? new Date(student.joinedAt).toLocaleDateString() : 'Unknown'}
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: INK, fontFamily: FONT }}>Overall Progress</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: AMBER }}>{student.progress || 0}%</span>
          </div>
          <div style={{ height: 8, background: BORDER, borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${student.progress || 0}%`, background: `linear-gradient(90deg, ${AMBER}, ${GREEN})`, borderRadius: 4 }} />
          </div>
        </div>

        {/* Enrol in another course — multi-select */}
        {courses.length > 0 && (
          <div style={{ background: LIGHT, borderRadius: 12, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: INK, fontFamily: FONT }}>Enrol in course(s)</div>
              <button
                onClick={toggleAll}
                style={{ fontSize: 11, color: AMBER, background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT, fontWeight: 600 }}
              >
                {enrolCourses.length === courses.length ? 'Deselect all' : 'All courses'}
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 160, overflowY: 'auto', marginBottom: 10 }}>
              {courses.map(c => (
                <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: INK, fontFamily: FONT }}>
                  <input
                    type="checkbox"
                    checked={enrolCourses.includes(c.id)}
                    onChange={() => toggleCourse(c.id)}
                    style={{ accentColor: AMBER, width: 14, height: 14 }}
                  />
                  {c.title}
                </label>
              ))}
            </div>
            <Btn
              size="sm"
              disabled={!enrolCourses.length || enrolLoading}
              onClick={handleEnrolInCourse}
              style={{ width: '100%' }}
            >
              {enrolLoading ? '…' : `Enrol in ${enrolCourses.length || ''} course${enrolCourses.length !== 1 ? 's' : ''}`}
            </Btn>
            {enrolOk && (
              <div style={{ fontSize: 12, color: enrolOk.startsWith('Error') ? RED : GREEN, marginTop: 6, fontFamily: FONT }}>
                {enrolOk}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Btn variant="danger" onClick={() => { onRemove(student.enrollmentId); onClose(); }}>
            <Trash2 size={14} /> Remove from courses
          </Btn>
        </div>
      </div>
    </div>
  );
}

/* ── Student row ────────────────────────────────────────────────────── */
function StudentRow({ student, onClick }) {
  return (
    <div
      onClick={() => onClick(student)}
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '12px 16px', background: WHITE, borderRadius: 12,
        border: `1px solid ${BORDER}`, cursor: 'pointer', transition: 'all .15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = AMBER; e.currentTarget.style.boxShadow = `0 2px 12px ${AMBER}18`; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.boxShadow = 'none'; }}
    >
      <div style={{
        width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
        background: `linear-gradient(135deg, ${AMBER}88, ${PURPLE}88)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, fontWeight: 700, color: WHITE,
      }}>
        {(student.fullName || student.email || '?')[0].toUpperCase()}
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: INK, fontFamily: FONT }}>{student.fullName || 'Unknown'}</div>
        <div style={{ fontSize: 11, color: MUTED, fontFamily: FONT }}>{student.email}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: INK, fontFamily: FONT }}>{student.progress || 0}%</div>
          <div style={{ fontSize: 10, color: MUTED, fontFamily: FONT }}>progress</div>
        </div>
        <StatusPill status={student.status} />
        <ChevronRight size={14} color={MUTED} />
      </div>
    </div>
  );
}

/* ── Main page ──────────────────────────────────────────────────────── */

export { EnrolModal, StudentSheet, StudentRow };
