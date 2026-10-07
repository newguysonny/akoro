import { useEffect, useMemo, useState } from 'react';
import { Modal } from './bits.jsx';
import { apiPost, apiGet } from '../../services/api.js';

/**
 * MessageModal — the "Send message" overlay (plan §4.6 Phase 4), an exact
 * conversion of the prototype's msg-overlay (reference/Admin-Tiers & Credits
 * prototype page.md): channel + template row, subject (hidden for SMS),
 * body, and the audience picker for school-directed messages. Templates fill
 * {parent}/{learner}/{school}/{end} client-side exactly like the prototype;
 * the server re-validates (lib/messageModel.js is contract-tested to the same
 * strings) and delivery runs in the background.
 *
 * context:
 *   { kind: 'sub',      customer, subscriptionId, learnerName }
 *   { kind: 'customer', customer, learnerNames }                 (no sub)
 *   { kind: 'school',   school: { id, name, contact, end_date } }
 */

const CHANNEL_OPTIONS = [['email', 'Email'], ['sms', 'SMS'], ['inapp', 'In-app notice']];
const CHANNEL_LABELS  = { email: 'Email', sms: 'SMS', inapp: 'In-app notice' };
const AUDIENCE_LABELS = {
  admins: 'School administrators',
  instructors: (n) => `Instructors${typeof n === 'number' ? ` (${n})` : ''}`,
  students: (n) => `Students${typeof n === 'number' ? ` (${n})` : ''}`,
  all: 'Everyone at the school',
};

const CUSTOMER_TEMPLATES = [['', 'None'], ['payment', 'Payment reminder'], ['trial', 'Trial ending'], ['general', 'General note']];
const SCHOOL_TEMPLATES   = [['', 'None'], ['pilot-end', 'Pilot ending'], ['cap', 'Credit usage update'], ['general', 'General note']];

const TEMPLATE_TEXT = {
  payment:  ['Payment reminder for {learner}', "Hi {parent}, we could not process the latest payment for {learner}'s Akoro plan. Please update your payment details so learning is not interrupted. Thank you."],
  trial:    ["{learner}'s Akoro trial is ending soon", "Hi {parent}, {learner}'s free trial ends soon. Upgrade to Premium to keep Battles, voice tutoring and the full AI credit allowance."],
  general:  ['A note from Akoro', 'Hi {parent}, '],
  'pilot-end': ['The Akoro pilot for {school} ends on {end}', 'Hello from Akoro. The pilot for {school} ends on {end}. Let us know if you would like to continue on Freemium or Premium so nobody loses access.'],
  cap:      ['Credit usage update for {school}', 'Hello from Akoro. {school} has used most of its pilot AI credits for this period. Let us know if you would like to discuss adjusting the allowance.'],
};

export default function MessageModal({ context, onClose, onSent }) {
  const isSchool = context.kind === 'school';
  const [audience, setAudience]     = useState('admins');
  const [channel, setChannel]       = useState('email');
  const [template, setTemplate]     = useState('');
  const [subject, setSubject]       = useState('');
  const [body, setBody]             = useState('');
  const [counts, setCounts]         = useState(null);
  const [busy, setBusy]             = useState(false);

  // Instructor/student counts behind the school (prototype shows them in the
  // audience labels). Best-effort — labels render without counts on failure.
  useEffect(() => {
    if (!isSchool) return;
    let alive = true;
    apiGet(`/api/admin/messages/audience?school_id=${context.school.id}`)
      .then((r) => { if (alive) setCounts(r.data ?? null); })
      .catch(() => {});
    return () => { alive = false; };
  }, [isSchool, context.school?.id]);

  const fillCtx = useMemo(() => {
    if (isSchool) {
      return { school: context.school.name, end: context.school.end_date ?? '' };
    }
    return {
      parent: context.customer?.name ?? '',
      learner: context.kind === 'sub'
        ? (context.learnerName || 'your learner')
        : (context.learnerNames?.length ? context.learnerNames.join(' and ') : 'your learner'),
    };
  }, [context, isSchool]);

  const applyTemplate = (t) => {
    setTemplate(t);
    if (!t) return;
    const [s, b] = TEMPLATE_TEXT[t];
    const fill = (str) => str
      .replaceAll('{parent}', fillCtx.parent)
      .replaceAll('{learner}', fillCtx.learner)
      .replaceAll('{school}', fillCtx.school)
      .replaceAll('{end}', fillCtx.end);
    setSubject(fill(s));
    setBody(isSchool && t === 'general' ? 'Hello, ' : fill(b));
  };

  const send = async () => {
    // Prototype-exact client-side checks; the server re-validates.
    if (channel !== 'sms' && !subject.trim()) { onSent(null, 'Add a subject'); return; }
    if (!body.trim()) { onSent(null, 'Write a message first'); return; }
    if (isSchool) {
      const ct = context.school.contact ?? {};
      if ((audience === 'admins' || audience === 'all') && channel === 'email' && !ct.email) { onSent(null, 'No admin contact email on file'); return; }
      if (audience === 'admins' && channel === 'sms' && !ct.phone) { onSent(null, 'No admin contact phone on file'); return; }
    } else {
      if (channel === 'email' && !context.customer?.email) { onSent(null, 'No email on file'); return; }
      if (channel === 'sms' && !context.customer?.phone) { onSent(null, 'No phone number on file'); return; }
    }

    setBusy(true);
    try {
      await apiPost('/api/admin/messages', {
        customer_id: !isSchool ? context.customer.id : undefined,
        subscription_id: context.kind === 'sub' ? context.subscriptionId : undefined,
        school_id: isSchool ? context.school.id : undefined,
        audience: isSchool ? audience : undefined,
        channel,
        subject: channel === 'sms' ? undefined : subject,
        body,
      });
      onSent(true, isSchool
        ? `Message sent to ${context.school.name}`
        : `Message sent to ${context.customer.name}`);
      onClose();
    } catch (e) {
      onSent(null, e.message || 'Could not send the message.');
    } finally {
      setBusy(false);
    }
  };

  const toLine = () => {
    if (isSchool) {
      const ct = context.school.contact ?? {};
      const parts = [ct.name, ct.email, ct.phone].filter(Boolean);
      return <>To the <b>{context.school.name}</b> pilot · Admin contact: {parts.length ? parts.join(' · ') : <span className="text-akoro-coral">none on file</span>}</>;
    }
    const c = context.customer;
    const bits = [c.email, c.phone].filter(Boolean);
    return <>To <b>{c.name}</b> · {bits.join(' · ')}{context.kind === 'sub' ? <> · regarding {`SUB-${String(context.subscriptionId).slice(0, 4).toUpperCase()}`}</> : ''}</>;
  };

  return (
    <Modal onClose={onClose}>
      <div className="!max-w-[480px]">
        <h2>Send message</h2>
        <p className="ak-sub !mt-1 !mb-3.5">{toLine()}</p>

        {isSchool && (
          <div className="ak-field">
            <label htmlFor="msg-audience">Audience</label>
            <select className="ak-select" id="msg-audience" value={audience} onChange={(e) => setAudience(e.target.value)}>
              <option value="admins">{AUDIENCE_LABELS.admins}</option>
              <option value="instructors">{AUDIENCE_LABELS.instructors(counts?.instructors)}</option>
              <option value="students">{AUDIENCE_LABELS.students(counts?.students)}</option>
              <option value="all">{AUDIENCE_LABELS.all}</option>
            </select>
          </div>
        )}

        <div className="ak-field-row">
          <div className="ak-field">
            <label htmlFor="msg-channel">Channel</label>
            <select className="ak-select" id="msg-channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
              {CHANNEL_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="ak-field">
            <label htmlFor="msg-template">Template</label>
            <select className="ak-select" id="msg-template" value={template} onChange={(e) => applyTemplate(e.target.value)}>
              {(isSchool ? SCHOOL_TEMPLATES : CUSTOMER_TEMPLATES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>

        {channel !== 'sms' && (
          <div className="ak-field">
            <label htmlFor="msg-subject">Subject</label>
            <input className="ak-input" type="text" id="msg-subject" value={subject}
              onChange={(e) => setSubject(e.target.value)} placeholder="Subject" autoFocus />
          </div>
        )}

        <div className="ak-field">
          <label htmlFor="msg-body">Message</label>
          <textarea className="ak-input" rows={5} id="msg-body" value={body} onChange={(e) => setBody(e.target.value)} />
        </div>

        <p className="ak-sub !text-[0.78rem] !my-1">Recorded in the message log and delivered via the configured provider.</p>

        <div className="ak-modal-actions">
          <button className="ak-btn ak-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="ak-btn" disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Send'}</button>
        </div>
      </div>
    </Modal>
  );
}
