import { useState } from 'react';
import { SiteNav, SiteFooter } from '../components/SiteChrome.jsx';
import { API } from '../services/api.js';

/**
 * PilotApplicationPage — public /apply page (Tiers & Credits plan §4.6 Phase 1)
 *
 * React + Tailwind conversion of reference/Pilot application.md, wired to the
 * ONE unauthenticated write endpoint of the plan:
 *
 *   POST /api/public/pilot-applications
 *
 * Client-side validation mirrors the prototype exactly (school name, students
 * > 0, contact name, email regex, phone ≥ 7 chars); the server re-validates
 * and adds a friendly duplicate guard (same school + email within 24h).
 * The prototype's standalone "Akoro" brand mark is omitted — the site nav
 * provides it on this page.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const EMPTY = {
  schoolName: '',
  state: '',
  estStudents: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  message: '',
};

export default function PilotApplicationPage() {
  const [form, setForm]         = useState(EMPTY);
  const [invalid, setInvalid]   = useState({});   // { field: true }
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const set = (field) => (e) => {
    setForm({ ...form, [field]: e.target.value });
    if (invalid[field]) setInvalid({ ...invalid, [field]: false });
  };

  const submitApplication = async (e) => {
    e.preventDefault();
    const errors = {
      schoolName:  !form.schoolName.trim(),
      state:       !form.state.trim(),
      estStudents: !(Number(form.estStudents) > 0),
      contactName: !form.contactName.trim(),
      contactEmail: !EMAIL_RE.test(form.contactEmail.trim()),
      contactPhone: form.contactPhone.trim().length < 7,
    };
    setInvalid(errors);
    if (Object.values(errors).some(Boolean)) return;

    setSubmitting(true);
    setServerError('');
    try {
      const r = await fetch(`${API}/api/public/pilot-applications`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          school_name:   form.schoolName.trim(),
          state_city:    form.state.trim(),
          est_students:  Number(form.estStudents),
          contact_name:  form.contactName.trim(),
          contact_email: form.contactEmail.trim(),
          contact_phone: form.contactPhone.trim(),
          message:       form.message.trim() || null,
        }),
      });
      if (r.ok) { setSubmitted(true); return; }
      const j = await r.json().catch(() => null);
      if (r.status === 409 && j?.code === 'duplicate_application') {
        // Already in the queue — treat as success so nobody re-submits in a panic.
        setSubmitted(true);
        return;
      }
      if (j?.fields) {
        // Map server field errors back onto the form.
        const map = {
          school_name: 'schoolName', state_city: 'state', est_students: 'estStudents',
          contact_name: 'contactName', contact_email: 'contactEmail',
          contact_phone: 'contactPhone', message: 'message',
        };
        const next = {};
        for (const [k, v] of Object.entries(j.fields)) if (map[k]) next[map[k]] = !!v;
        setInvalid(next);
        setServerError(j.message || 'Please check the highlighted fields and try again.');
      } else {
        setServerError(j?.message || 'Could not submit your application. Please try again.');
      }
    } catch {
      setServerError('Network problem — please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="font-nunito text-akoro-ink bg-akoro-bg min-h-screen [&_*]:box-border">
      <SiteNav />

      <div className="max-w-[640px] mx-auto px-6 pt-12 pb-16">
        {submitted ? (
          /* ── success view (exact prototype) ── */
          <div className="text-center py-[50px] px-[26px] bg-akoro-surface border border-akoro-line rounded-[20px]">
            <div className="w-[60px] h-[60px] rounded-full bg-akoro-greensoft text-akoro-green flex items-center justify-center text-[1.8rem] mx-auto mb-[18px]">✓</div>
            <h2 className="text-[1.3rem] font-black mb-2.5">Application received</h2>
            <p className="text-akoro-dim leading-[1.5] m-0">
              Thanks for applying to the Akoro pilot programme. Our team will review your
              details and reach out by email within a few days.
            </p>
          </div>
        ) : (
          /* ── application form (exact prototype) ── */
          <>
            <h1 className="text-[2rem] font-black leading-[1.15] mb-3">Bring Akoro to your school</h1>
            <p className="text-akoro-dim text-[1.05rem] leading-[1.5] mb-7">
              Apply for our free pilot programme and give your teachers and students full
              access to Akoro&rsquo;s AI learning tools for a month, at no cost.
            </p>

            <div className="flex flex-col gap-2.5 mb-9">
              {[
                'Free access for every instructor and student during the pilot',
                'A free school website, built in from day one',
                'Hands-on onboarding support for your teaching staff',
                'No commitment — decide whether to continue once the pilot ends',
              ].map((perk) => (
                <div key={perk} className="flex gap-2.5 items-start text-[0.95rem] font-semibold">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-akoro-greensoft text-akoro-green flex items-center justify-center text-[0.75rem] font-black mt-px">✓</span>
                  {perk}
                </div>
              ))}
            </div>

            <form onSubmit={submitApplication} className="bg-akoro-surface border border-akoro-line rounded-[20px] px-[26px] py-7" noValidate>
              <Field label="School name" htmlFor="schoolName" invalid={invalid.schoolName} error="Enter your school's name">
                <input
                  type="text" id="schoolName" placeholder="e.g. Chrisland College"
                  className={inputCls(invalid.schoolName)} value={form.schoolName} onChange={set('schoolName')}
                />
              </Field>

              <div className="flex flex-col sm:flex-row gap-3">
                <Field label="State / City" htmlFor="state" invalid={invalid.state} error="Enter your state or city" className="flex-1">
                  <input
                    type="text" id="state" placeholder="e.g. Lagos"
                    className={inputCls(invalid.state)} value={form.state} onChange={set('state')}
                  />
                </Field>
                <Field label="Estimated students" htmlFor="estStudents" invalid={invalid.estStudents} error="Enter an estimated number of students" className="flex-1">
                  <input
                    type="number" min="1" id="estStudents" placeholder="e.g. 150"
                    className={inputCls(invalid.estStudents)} value={form.estStudents} onChange={set('estStudents')}
                  />
                </Field>
              </div>

              <Field label="Your name" htmlFor="contactName" invalid={invalid.contactName} error="Enter your name">
                <input
                  type="text" id="contactName" placeholder="e.g. Mrs. Folake Adeyemi"
                  className={inputCls(invalid.contactName)} value={form.contactName} onChange={set('contactName')}
                />
              </Field>

              <div className="flex flex-col sm:flex-row gap-3">
                <Field label="Email" htmlFor="contactEmail" invalid={invalid.contactEmail} error="Enter a valid email address" className="flex-1">
                  <input
                    type="email" id="contactEmail" placeholder="you@school.com"
                    className={inputCls(invalid.contactEmail)} value={form.contactEmail} onChange={set('contactEmail')}
                  />
                </Field>
                <Field label="Phone" htmlFor="contactPhone" invalid={invalid.contactPhone} error="Enter a phone number" className="flex-1">
                  <input
                    type="text" id="contactPhone" placeholder="+234 800 000 0000"
                    className={inputCls(invalid.contactPhone)} value={form.contactPhone} onChange={set('contactPhone')}
                  />
                </Field>
              </div>

              <Field
                label={<>Tell us about your school <span className="font-semibold text-akoro-dim text-[0.78rem]">(optional)</span></>}
                htmlFor="message"
              >
                <textarea
                  id="message" placeholder="What grade levels do you teach, and why are you interested in Akoro?"
                  className={`${inputCls(false)} min-h-[90px] resize-y`}
                  value={form.message} onChange={set('message')}
                />
              </Field>

              {serverError && (
                <p className="text-akoro-coral text-[0.82rem] font-bold mt-0 mb-2">{serverError}</p>
              )}

              <button
                type="submit" disabled={submitting}
                className="w-full py-[15px] rounded-full border-none bg-akoro-purple hover:bg-akoro-purpledark disabled:opacity-60 text-white font-extrabold text-base cursor-pointer mt-1.5"
              >
                {submitting ? 'Submitting…' : 'Submit application'}
              </button>
              <p className="text-[0.78rem] text-akoro-dim text-center mt-3.5 leading-[1.4]">
                Our team reviews applications and typically responds within a few days.
              </p>
            </form>
          </>
        )}
      </div>

      <SiteFooter />
    </div>
  );
}

/* Prototype input styling: 12px radius, bg #FAFAFC, coral border + error text when invalid. */
const inputCls = (invalid) =>
  `w-full py-[11px] px-3.5 rounded-xl border bg-akoro-bg text-akoro-ink text-[0.95rem] outline-none focus:outline focus:outline-2 focus:outline-akoro-purple focus:outline-offset-1 font-nunito ${invalid ? 'border-akoro-coral' : 'border-akoro-line'}`;

function Field({ label, htmlFor, invalid, error, className = '', children }) {
  return (
    <div className={`mb-[18px] ${invalid ? 'invalid' : ''} ${className}`}>
      <label htmlFor={htmlFor} className="block text-[0.85rem] font-bold mb-1.5">{label}</label>
      {children}
      {invalid && <div className="text-akoro-coral text-[0.8rem] font-bold mt-[5px]">{error}</div>}
    </div>
  );
}
