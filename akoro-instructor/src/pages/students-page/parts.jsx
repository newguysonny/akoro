/**
 * StudentsPage — constants + child components.
 */
import { useState, useEffect, useRef } from 'react';
import {
  Search, Plus, X, User, Mail, Calendar, BookOpen, TrendingUp,
  Trash2, ChevronRight, Copy, Check, Upload, Download, Link2, UserPlus,  PencilLine, ClipboardList } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../components/Layout.jsx';
import { Btn, Modal, Inp, StatusPill, Toast } from '../../components/Primitives.jsx';
import { apiGet } from '../../services/api.js';
import { useStudentsAPI } from '../../hooks/useStudentsAPI.js';
import { useCoursesAPI }  from '../../hooks/useCoursesAPI.js';
import { GREEN, PURPLE, BLUE, RED } from '../../constants.js';
import { C, tint } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';

/* ── Enrol Modal — tabs: Manual | Invite Link | Bulk CSV ─────────────── */

function EnrolModal({ open, onClose, onDone, courses = [] }) {
  const { addStudent, generateInvite, importCSV } = useStudentsAPI();
  const [tab, setTab]       = useState('manual');
  const [loading, setLoad]  = useState(false);
  const [error, setError]   = useState('');
  const [success, setOk]    = useState('');
  const fileRef = useRef(null);

  // Manual form
  const [classes, setClasses] = useState([]);
  const [classesLoading, setClassesLoading] = useState(true);
  const [manual, setManual] = useState({ email: '', fullName: '', classId: '', courseIds: [] });
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
  const [csv, setCsv]       = useState({ courseId: '', classId: '', file: null });
  const [csvResult, setCsvR] = useState(null);

  // The classes this teacher can add to. Loaded here rather than passed in,
  // because the page above only ever knew about courses.
  useEffect(() => {
    if (!open) return;
    setClassesLoading(true);
    apiGet('/api/instructor/classrooms')
      .then(d => {
        const list = d?.data ?? [];
        setClasses(list);
        setManual(f => ({ ...f, classId: f.classId || list[0]?.id || '' }));
        setCsv(f => ({ ...f, classId: f.classId || list[0]?.id || '' }));
      })
      .catch(() => setClasses([]))
      .finally(() => setClassesLoading(false));
  }, [open]);

  useEffect(() => {
    if (open) {
      setTab('manual'); setLoad(false); setError(''); setOk('');
      setManual(f => ({ email: '', fullName: '', classId: f.classId || '', courseIds: [] }));
      setInv({ courseIds: [], expiresInDays: 7, emails: '' });
      setUrl(''); setCopied(false);
      setCsv(f => ({ courseId: '', classId: f.classId || '', file: null })); setCsvR(null);
    }
  }, [open]);

  const reset = () => { setError(''); setOk(''); };

  /* Manual submit */
  const submitManual = async (e) => {
    e.preventDefault(); reset();
    if (!manual.email) { setError('Email is required'); return; }
    if (!manual.classId && !manual.courseIds.length) {
      setError('Pick a class, or at least one course.'); return;
    }
    setLoad(true);
    const errors = [];
    let addedToClass = false;
    let enrolled = 0;

    // One call per course, but the CLASS only needs adding once — send it with
    // the first request and omit it after, or every course would re-upsert the
    // same membership.
    const courseList = manual.courseIds.length ? manual.courseIds : [null];
    for (let i = 0; i < courseList.length; i++) {
      try {
        const r = await addStudent({
          email: manual.email,
          fullName: manual.fullName,
          courseId: courseList[i],
          classroomId: i === 0 ? (manual.classId || null) : null,
        });
        const d = r?.data ?? r;
        if (d?.addedToClass) addedToClass = true;
        if (d?.enrolled) enrolled += 1;
      } catch (err) { errors.push(err.message); }
    }
    setLoad(false);

    if (!addedToClass && !enrolled) {
      setError(errors[0] || 'Failed to add student');
      return;
    }
    // Say what actually happened. "Added to 2 courses" while the class silently
    // failed is how this went unnoticed in the first place.
    const className = classes.find(c => c.id === manual.classId)?.name;
    const bits = [];
    if (addedToClass && className) bits.push(`added to ${className}`);
    if (enrolled) bits.push(`enrolled in ${enrolled} course${enrolled > 1 ? 's' : ''}`);
    setOk(`Student ${bits.join(' and ')}. They'll receive a welcome email to set their password.` +
          (errors.length ? ` (${errors.length} skipped: ${errors[0]})` : ''));
    onDone?.();
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
    if (!csv.file) { setError('Please choose a CSV file'); return; }
    if (!csv.classId && !csv.courseId) {
      setError('Pick a class, or a course — the students have to be added to something.'); return;
    }
    setLoad(true);
    try {
      const result = await importCSV(csv.file, csv.courseId || null, csv.classId || null);
      setCsvR(result);
      onDone?.();
    } catch (err) {
      setError(err.message || 'Import failed');
    } finally { setLoad(false); }
  };

  /* A STARTER file, not a finished one: the teacher opens it, replaces the two
     example rows with their register, and uploads it back. Generated in the
     browser rather than hosted so it can never drift from the format the
     importer actually parses (name, email, phone).

     Two details that matter for a file people open in Excel:
       • a UTF-8 BOM, or Excel mangles any name with an accent in it
       • CRLF line endings, which Excel and Numbers both expect
     And it keeps example rows rather than shipping headers alone, because the
     importer rejects a file with no data rows — a header-only template would
     fail on upload and look like the feature was broken. */
  const downloadTemplate = () => {
    const csvText = '\uFEFF' + [
      'name,email,phone',
      'Zainab Bello,zainab.bello@example.com,+2348012345678',
      'Ifeanyi Obi,ifeanyi.obi@example.com,',
    ].join('\r\n') + '\r\n';

    const url = URL.createObjectURL(new Blob([csvText], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'akoro-students-template.csv';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoked on the next tick — Safari cancels the download if the URL is
    // released in the same frame as the click.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const TAB_STYLE = (active) => ({
    flex: 1, padding: '8px 4px', border: 'none', borderRadius: 8,
    background: active ? C.surface : 'transparent',
    color: active ? C.brand : C.muted, fontWeight: active ? 700 : 500,
    fontSize: 12, fontFamily: C.font, cursor: 'pointer',
    boxShadow: active ? `0 1px 4px ${tint(13)}` : 'none',
    transition: 'all .15s',
  });

  const CourseChecklist = ({ selected, onToggle, onToggleAll }) => (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <label style={{ fontSize: 12, fontWeight: 700, color: C.ink, fontFamily: C.font }}>
          Enrol in Course(s) <span style={{ fontWeight: 500, color: C.muted }}>— optional</span>
        </label>
        <button
          type="button"
          onClick={onToggleAll}
          style={{ fontSize: 11, color: C.brand, background: 'none', border: 'none', cursor: 'pointer', fontFamily: C.font, fontWeight: 700 }}
        >
          {selected.length === courses.length && courses.length > 0 ? 'Deselect all' : 'All courses'}
        </button>
      </div>
      <div style={{
        border: `1.5px solid ${C.border}`, borderRadius: 10, padding: 8,
        maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4,
        background: C.surface,
      }}>
        {courses.length === 0 && (
          <div style={{ fontSize: 12, color: C.muted, padding: '6px 4px', fontFamily: C.font }}>No courses yet — create one first.</div>
        )}
        {courses.map(c => (
          <label key={c.id} style={{
            display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
            fontSize: 13, color: C.ink, fontFamily: C.font, padding: '5px 4px', borderRadius: 6,
          }}>
            <input
              type="checkbox"
              checked={selected.includes(c.id)}
              onChange={() => onToggle(c.id)}
              style={{ accentColor: C.brand, width: 15, height: 15 }}
            />
            {c.title}
          </label>
        ))}
      </div>
    </div>
  );

  const CourseSelect = ({ value, onChange }) => (
    <div>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 6, fontFamily: C.font }}>
        Enrol in Course *
      </label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', padding: '10px 12px', borderRadius: 10,
          border: `1.5px solid ${C.border}`, fontFamily: C.font, fontSize: 13,
          color: value ? C.ink : C.muted, background: C.surface, outline: 'none',
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
        <div style={{ background: tint(9, RED), border: `1px solid ${tint(30, RED)}`, borderRadius: 10, padding: '10px 14px', fontSize: 13, color: RED }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ background: tint(9, GREEN), border: `1px solid ${tint(30, GREEN)}`, borderRadius: 10, padding: '10px 14px', fontSize: 13, color: GREEN }}>
          {success}
        </div>
      )}
    </>
  );

  return (
    <Modal open={open} onClose={onClose} title="Add a Student">
      {/* Tab bar */}
      <div style={{ display: 'flex', background: C.bg, borderRadius: 10, padding: 4, marginBottom: 20, gap: 2 }}>
        <button style={TAB_STYLE(tab === 'manual')} onClick={() => { setTab('manual'); reset(); }}>
          <Ico lucide={PencilLine} ti="ti-pencil" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Manual Entry
        </button>
        <button style={TAB_STYLE(tab === 'invite')} onClick={() => { setTab('invite'); reset(); }}>
          <Ico lucide={Mail} ti="ti-mail" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Invite Link
        </button>
        <button style={TAB_STYLE(tab === 'csv')} onClick={() => { setTab('csv'); reset(); }}>
          <Ico lucide={ClipboardList} ti="ti-clipboard-list" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Bulk CSV
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
          {/* Class first: it is what a student BELONGS to. A course is
              something they may or may not also be taking. */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: C.ink, fontFamily: C.font, display: 'block', marginBottom: 6 }}>
              Class
            </label>
            <select
              value={manual.classId}
              onChange={e => setM('classId', e.target.value)}
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 10,
                border: `1.5px solid ${C.border}`, outline: 'none', fontSize: 14,
                fontFamily: C.font, color: C.ink, background: C.surface, cursor: 'pointer', boxSizing: 'border-box',
              }}
            >
              <option value="">{classesLoading ? 'Loading classes…' : 'No class'}</option>
              {classes.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.student_count ? ` — ${c.student_count} learner${c.student_count === 1 ? '' : 's'}` : ''}
                </option>
              ))}
            </select>
            {!classesLoading && !classes.length && (
              <p style={{ fontSize: 11, color: C.muted2, fontFamily: C.font, margin: '5px 0 0' }}>
                No classes yet — create one under Academics → Classes.
              </p>
            )}
          </div>

          <CourseChecklist selected={manual.courseIds} onToggle={toggleManualCourse} onToggleAll={toggleAllManualCourses} />
          <p style={{ fontSize: 12, color: C.muted, margin: 0 }}>
            Courses are optional — a student can be in a class without taking any.
            If they don't have an Akoro account yet, one is created automatically and
            they set their password via the welcome email.
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
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 6, fontFamily: C.font }}>
              Link Expires In
            </label>
            <select
              value={inv.expiresInDays}
              onChange={e => setI('expiresInDays', e.target.value)}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 10,
                border: `1.5px solid ${C.border}`, fontFamily: C.font, fontSize: 13,
                color: C.ink, background: C.surface, outline: 'none',
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
              background: C.bg, border: `1.5px solid ${C.border}`, borderRadius: 10,
              padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <Ico lucide={Link2} ti="ti-link" size={14} color={C.brand} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 11, color: C.ink, fontFamily: C.font, wordBreak: 'break-all' }}>
                {inviteUrl}
              </span>
              <button
                type="button"
                onClick={copyLink}
                style={{
                  background: copied ? GREEN : C.brand, border: 'none', borderRadius: 7,
                  padding: '6px 10px', cursor: 'pointer', color: '#fff',
                  display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontFamily: C.font,
                }}
              >
                {copied ? <Ico lucide={Check} ti="ti-check" size={12} /> : <Ico lucide={Copy} ti="ti-copy" size={12} />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          )}

          <p style={{ fontSize: 12, color: C.muted, margin: 0 }}>
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

          {/* Same order as Manual: the class is what they join, the course is
              extra. A register is usually a class register. */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: C.ink, fontFamily: C.font, display: 'block', marginBottom: 6 }}>
              Add to class
            </label>
            <select
              value={csv.classId}
              onChange={e => setCsv(f => ({ ...f, classId: e.target.value }))}
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 10,
                border: `1.5px solid ${C.border}`, outline: 'none', fontSize: 14,
                fontFamily: C.font, color: C.ink, background: C.surface, cursor: 'pointer', boxSizing: 'border-box',
              }}
            >
              <option value="">{classesLoading ? 'Loading classes…' : 'No class'}</option>
              {classes.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.student_count ? ` — ${c.student_count} learner${c.student_count === 1 ? '' : 's'}` : ''}
                </option>
              ))}
            </select>
          </div>

          <CourseSelect value={csv.courseId} onChange={v => setCsv(f => ({ ...f, courseId: v }))} />

          {/* Drop zone */}
          <div
            onClick={() => fileRef.current?.click()}
            style={{
              border: `2px dashed ${csv.file ? C.brand : C.border}`, borderRadius: 12,
              padding: '24px', textAlign: 'center', cursor: 'pointer',
              background: csv.file ? tint(3) : C.bg, transition: 'all .15s',
            }}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) setCsv(c => ({ ...c, file: f }));
            }}
          >
            <Ico lucide={Upload} ti="ti-upload" size={22} color={csv.file ? C.brand : C.muted} style={{ marginBottom: 8 }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: csv.file ? C.brand : C.ink, fontFamily: C.font }}>
              {csv.file ? csv.file.name : 'Drop CSV file here or click to browse'}
            </div>
            {csv.file && (
              <div style={{ fontSize: 11, color: C.muted, marginTop: 4, fontFamily: C.font }}>
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

          <div style={{ background: C.bg, borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.ink, fontFamily: C.font }}>
                CSV format — one student per row:
              </div>
              <button type="button" onClick={downloadTemplate} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px',
                borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface,
                color: C.brand, fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: C.font,
                flexShrink: 0,
              }}>
                <Ico lucide={Download} ti="ti-download" size={12} /> Starter file
              </button>
            </div>
            <code style={{ fontSize: 11, color: C.muted, fontFamily: 'monospace' }}>
              name,email,phone<br />
              Jane Doe,jane@example.com,+2348012345678<br />
              John Smith,john@example.com,
            </code>
            <div style={{ fontSize: 10.5, color: C.muted2, fontFamily: C.font, marginTop: 6, lineHeight: 1.45 }}>
              Download the starter file, replace the two example rows with your students,
              and upload it back. Phone is optional; extra columns are ignored.
            </div>
          </div>

          {csvResult && (
            <div style={{ background: tint(9, GREEN), border: `1px solid ${tint(30, GREEN)}`, borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: GREEN, marginBottom: 6, fontFamily: C.font }}>
                Import complete
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {[
                  { label: 'New accounts', value: csvResult.accounts_created ?? 0 },
                  { label: 'Already existed', value: csvResult.already_existed ?? 0 },
                  { label: 'Enrolled', value: (csvResult.accounts_created ?? 0) + (csvResult.already_existed ?? 0) },
                  { label: 'Failed rows', value: csvResult.failed ?? 0, warn: true },
                ].map(({ label, value, warn }) => (
                  <div key={label} style={{ fontSize: 12, color: warn && value ? RED : C.ink, fontFamily: C.font }}>
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
          width: 360, height: '100vh', background: C.surface, boxShadow: '-8px 0 40px rgba(0,0,0,.12)',
          padding: '24px', overflowY: 'auto', animation: 'sheet-up .25s ease both',
          display: 'flex', flexDirection: 'column', gap: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: C.ink, margin: 0, fontFamily: C.font }}>Student Profile</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted }}>
            <Ico lucide={X} ti="ti-x" size={18} />
          </button>
        </div>

        {/* Avatar + name */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '20px', background: C.bg, borderRadius: 16 }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            background: `linear-gradient(135deg, ${C.brand}, ${PURPLE})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 24, color: '#fff', fontWeight: 700,
          }}>
            {(student.fullName || student.email || '?')[0].toUpperCase()}
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.ink, fontFamily: C.font }}>{student.fullName || 'Unknown'}</div>
            <div style={{ fontSize: 13, color: C.muted, fontFamily: C.font }}>{student.email}</div>
          </div>
          <StatusPill status={student.status} />
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {[
            { label: 'Courses', value: student.coursesEnrolled || 0, icon: BookOpen, ti: 'ti-book', color: BLUE },
            { label: 'Progress', value: `${student.progress || 0}%`, icon: TrendingUp, ti: 'ti-trending-up', color: GREEN },
          ].map(({ label, value, icon: Icon, ti, color }) => (
            <div key={label} style={{ background: C.bg, borderRadius: 12, padding: '14px', textAlign: 'center' }}>
              <Ico lucide={Icon} ti={ti} size={18} color={color} style={{ marginBottom: 6 }} />
              <div style={{ fontSize: 20, fontWeight: 800, color: C.ink, fontFamily: C.font }}>{value}</div>
              <div style={{ fontSize: 11, color: C.muted, fontFamily: C.font }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Details */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Ico lucide={Mail} ti="ti-mail" size={14} color={C.muted} />
            <span style={{ fontSize: 13, color: C.muted, fontFamily: C.font }}>{student.email}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Ico lucide={Calendar} ti="ti-calendar" size={14} color={C.muted} />
            <span style={{ fontSize: 13, color: C.muted, fontFamily: C.font }}>
              Joined {student.joinedAt ? new Date(student.joinedAt).toLocaleDateString() : 'Unknown'}
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.ink, fontFamily: C.font }}>Overall Progress</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.brand }}>{student.progress || 0}%</span>
          </div>
          <div style={{ height: 8, background: C.border, borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${student.progress || 0}%`, background: `linear-gradient(90deg, ${C.brand}, ${GREEN})`, borderRadius: 4 }} />
          </div>
        </div>

        {/* Enrol in another course — multi-select */}
        {courses.length > 0 && (
          <div style={{ background: C.bg, borderRadius: 12, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, fontFamily: C.font }}>Enrol in course(s)</div>
              <button
                onClick={toggleAll}
                style={{ fontSize: 11, color: C.brand, background: 'none', border: 'none', cursor: 'pointer', fontFamily: C.font, fontWeight: 600 }}
              >
                {enrolCourses.length === courses.length ? 'Deselect all' : 'All courses'}
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 160, overflowY: 'auto', marginBottom: 10 }}>
              {courses.map(c => (
                <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: C.ink, fontFamily: C.font }}>
                  <input
                    type="checkbox"
                    checked={enrolCourses.includes(c.id)}
                    onChange={() => toggleCourse(c.id)}
                    style={{ accentColor: C.brand, width: 14, height: 14 }}
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
              <div style={{ fontSize: 12, color: enrolOk.startsWith('Error') ? RED : GREEN, marginTop: 6, fontFamily: C.font }}>
                {enrolOk}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Btn variant="danger" onClick={() => { onRemove(student.enrollmentId); onClose(); }}>
            <Ico lucide={Trash2} ti="ti-trash" size={14} /> Remove from courses
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
        padding: '12px 16px', background: C.surface, borderRadius: 12,
        border: `1px solid ${C.border}`, cursor: 'pointer', transition: 'all .15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = C.brand; e.currentTarget.style.boxShadow = `0 2px 12px ${tint(9)}`; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.boxShadow = 'none'; }}
    >
      <div style={{
        width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
        background: `linear-gradient(135deg, ${tint(53)}, ${PURPLE}88)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, fontWeight: 700, color: '#fff',
      }}>
        {(student.fullName || student.email || '?')[0].toUpperCase()}
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, fontFamily: C.font }}>{student.fullName || 'Unknown'}</div>
        <div style={{ fontSize: 11, color: C.muted, fontFamily: C.font }}>{student.email}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.ink, fontFamily: C.font }}>{student.progress || 0}%</div>
          <div style={{ fontSize: 10, color: C.muted, fontFamily: C.font }}>progress</div>
        </div>
        <StatusPill status={student.status} />
        <Ico lucide={ChevronRight} ti="ti-chevron-right" size={14} color={C.muted} />
      </div>
    </div>
  );
}

/* ── Main page ──────────────────────────────────────────────────────── */

export { EnrolModal, StudentSheet, StudentRow };
