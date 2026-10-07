/**
 * InstructorInfoPage — brand tokens, frame chrome, and content section components.
 */
import React, { useState, useEffect, useRef } from "react";
import {
  Menu,
  X,
  MessageCircle,
  CalendarDays,
  Ticket,
  ChevronDown,
  Repeat2,
  Trophy,
  BarChart3,
  BookOpen,
  WifiOff,
  ArrowRight,
  PenTool,
  CheckCircle2,
} from "lucide-react";
import { SiteNav, SFSHeader, SiteFooter } from '../../components/SiteChrome.jsx';
import { Icon } from '../../components/common/Icons.jsx';


/* ── Brand tokens (match Akoro landing page) ── */
const B = "#6C3BFF";
const B2 = "#4C1DCC";

function FontImport() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Lora:wght@600;700;800&family=Poppins:wght@400;500;600;700;800&display=swap');
    `}</style>
  );
}

function AnnouncementBar({ onDismiss }) {
  return (
    <div
      className="flex items-center justify-center gap-2 text-center px-6 py-3 text-sm"
      style={{ background: "#F1EBFF", color: "#3A2570" }}
    >
      <span className="max-w-md leading-snug">
        <Icon name="ti-users" size={14} style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 5 }}/>4,000+ instructors trust Akoro. See how they{" "}
        <a href="/signup" className="font-bold underline underline-offset-2">
          teach smarter
        </a>
        .
      </span>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 text-[#7A6FA8] hover:text-[#3A2570] transition-colors"
      >
        <X size={16} />
      </button>
    </div>
  );
}

/* ── Product preview card (Akoro equivalent of Gusto's "Run payroll" card) ── */
function ProductPreviewCard() {
  return (
    <div className="relative max-w-md mx-auto lg:mx-0 lg:max-w-full">
      {/* soft blurred glow behind the card, like the reference */}
      <div
        className="absolute -inset-8 rounded-[40px] blur-3xl opacity-40 -z-10"
        style={{ background: "linear-gradient(135deg,#D9CBFF,#F1EBFF)" }}
      />

      <div className="bg-white rounded-3xl shadow-2xl border border-[#EDE8F7] p-6 sm:p-7">
        <h3
          className="text-2xl font-extrabold text-[#0F0F1E] mb-1"
          style={{ fontFamily: "'Poppins', sans-serif" }}
        >
          Grade quizzes
        </h3>
        <p className="text-sm text-[#8A87A0] mb-5">Week 6 · Physics 101</p>

        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-bold text-[#0F0F1E]">
            Review submissions
          </span>
          <span
            className="text-sm font-bold flex items-center gap-1 underline underline-offset-2"
            style={{ color: B }}
          >
            Step 1 of 2 <ChevronDown size={14} />
          </span>
        </div>
        <div className="h-2 rounded-full bg-[#EEE9F9] overflow-hidden mb-6">
          <div
            className="h-full rounded-full"
            style={{ width: "40%", background: B }}
          />
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="border border-[#EDE8F7] rounded-xl p-3 flex items-center gap-2.5">
            <CalendarDays size={20} style={{ color: B }} />
            <div>
              <div className="text-xs font-bold text-[#0F0F1E]">Due</div>
              <div className="text-xs text-[#8A87A0]">Wed, Jul 15</div>
            </div>
          </div>
          <div className="border border-[#EDE8F7] rounded-xl p-3 flex items-center gap-2.5">
            <Ticket size={20} style={{ color: B }} />
            <div>
              <div className="text-xs font-bold text-[#0F0F1E]">
                Auto-graded
              </div>
              <div className="text-xs text-[#8A87A0]">42 of 48</div>
            </div>
          </div>
        </div>

        <div className="border border-[#EDE8F7] rounded-xl px-4 py-3 flex items-center justify-between mb-4">
          <span className="text-sm font-bold text-[#0F0F1E]">
            Class size
          </span>
          <span className="text-sm font-extrabold text-[#0F0F1E] flex items-center gap-1">
            48 <ChevronDown size={14} className="text-[#8A87A0]" />
          </span>
        </div>

        <div className="border border-[#EDE8F7] rounded-xl overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3.5">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
              style={{ background: B2 }}
            >
              TB
            </div>
            <span className="font-bold text-sm text-[#0F0F1E]">
              Tunde Balogun
            </span>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-dashed border-[#EDE8F7]">
            <span className="text-sm text-[#5A5A6E]">Score</span>
            <span className="text-sm font-semibold text-[#0F0F1E]">92%</span>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="text-sm text-[#5A5A6E]">Time spent</span>
            <span className="text-sm font-semibold text-[#0F0F1E]">
              18 min
            </span>
          </div>
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ background: "#F1EBFF" }}
          >
            <span className="text-sm font-bold text-[#0F0F1E]">
              Flagged for review
            </span>
            <span className="text-sm font-extrabold" style={{ color: B }}>
              2 students
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Accordion feature section (Akoro equivalent of Gusto's "Payroll takes just a few clicks" list) ── */
function FeatureAccordion() {
  const items = [
    {
      title: "Grading takes just a few clicks",
      desc: "Plus, we auto-grade quizzes, flag learning gaps, and surface insights you may never have known your students needed.",
      link: "Learn more about grading",
    },
    {
      title: "Sync lesson plans with your calendar",
      desc: "Akoro syncs directly with Google Calendar and your school's timetable, so every lesson plan shows up exactly when it should.",
      link: "Learn more about lesson planning",
    },
    {
      title: "Get a weekly forecast of your classes",
      desc: "See every class, assignment deadline, and live session for the week ahead — laid out before Monday even starts.",
      link: "Learn more about weekly forecasts",
    },
  ];
  const [open, setOpen] = useState(0);
  const [progress, setProgress] = useState(0);
  const AUTO_MS = 5000;
  const pausedRef = useRef(false);
  const elapsedRef = useRef(0);

  // Fill the divider under the open item over AUTO_MS, then advance to the next one.
  // Paused (via pausedRef) while the user is hovering the accordion.
  useEffect(() => {
    setProgress(0);
    elapsedRef.current = 0;
    const tick = setInterval(() => {
      if (pausedRef.current) return;
      elapsedRef.current += 40;
      const pct = Math.min(100, (elapsedRef.current / AUTO_MS) * 100);
      setProgress(pct);
      if (pct >= 100) {
        clearInterval(tick);
        setOpen((prev) => (prev + 1) % items.length);
      }
    }, 40);
    return () => clearInterval(tick);
  }, [open]);

  const selectItem = (i) => {
    if (i === open) return;
    setOpen(i);
  };

  return (
    <div
      className="max-w-2xl mx-auto px-6 pb-16"
      onMouseEnter={() => (pausedRef.current = true)}
      onMouseLeave={() => (pausedRef.current = false)}
    >
      <h2
        className="text-[clamp(30px,7vw,44px)] font-black leading-[1.05] mb-10"
        style={{
          color: "#0F0F1E",
          fontFamily: "'Lora', serif",
          letterSpacing: "-0.01em",
        }}
      >
        Plan lessons in minutes with an AI co-teacher.
      </h2>

      <div className="border-t border-[#E5E2EE]">
        {items.map((item, i) => {
          const isOpen = open === i;
          return (
            <div key={item.title}>
              <button
                onClick={() => selectItem(i)}
                className="w-full flex items-center justify-between gap-4 py-6 text-left"
              >
                <span className="text-lg sm:text-xl font-bold text-[#0F0F1E] leading-snug">
                  {item.title}
                </span>
                <ChevronDown
                  size={20}
                  style={{ color: B }}
                  className={`shrink-0 transition-transform duration-300 ${
                    isOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              <div
                className="overflow-hidden transition-all duration-300 ease-in-out"
                style={{
                  maxHeight: isOpen ? "220px" : "0px",
                  opacity: isOpen ? 1 : 0,
                }}
              >
                <p className="text-base text-[#5A5A6E] leading-relaxed pb-4 max-w-md">
                  {item.desc}
                </p>
                <a
                  href="/signup"
                  className="inline-block text-base font-bold underline underline-offset-2 pb-6"
                  style={{ color: B }}
                >
                  {item.link} →
                </a>
              </div>

              {/* Divider that fills like a timer while this item is open, then auto-advances */}
              <div className="relative h-px bg-[#E5E2EE] overflow-hidden">
                {isOpen && (
                  <div
                    className="absolute inset-y-0 left-0 h-px"
                    style={{ width: `${progress}%`, background: B }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <button
        className="mt-10 px-8 py-3.5 rounded-lg font-bold text-base border-2 hover:bg-[#F1EBFF] transition-colors"
        style={{ color: B, borderColor: B }}
      >
        Why Akoro
      </button>
    </div>
  );
}

/* ── Testimonial quote section (Akoro equivalent of Gusto's customer quote block) ── */
function TestimonialQuote() {
  return (
    <div className="bg-[#F7F6FA] px-6 py-20">
      <div className="max-w-2xl mx-auto text-center">
        <p className="text-base font-bold text-[#8A87A0] tracking-wide mb-8">
          Saved over 6 hours a week
        </p>

        <p
          className="text-[clamp(24px,6vw,38px)] font-black leading-[1.25] mb-10"
          style={{
            color: "#0F0F1E",
            fontFamily: "'Lora', serif",
          }}
        >
          &ldquo;Grading used to eat my entire weekend. With Akoro, quizzes
          are graded instantly and I walk into Monday already knowing
          exactly which students need extra help.&rdquo;
        </p>

        <p className="text-lg font-bold text-[#0F0F1E] mb-4">
          Mr. Tunde Bakare
        </p>
        <div className="w-16 h-px bg-[#D8D4E5] mx-auto mb-4" />
        <p className="text-base text-[#5A5A6E] mb-8">
          Mathematics Teacher, Lagos
        </p>

        <a
          href="/signup"
          className="text-base font-bold underline underline-offset-2"
          style={{ color: B }}
        >
          Read the full story
        </a>
      </div>
    </div>
  );
}

/* ── Text + image feature row (Akoro equivalent of Gusto's "Hire standout candidates" / "employee benefits" blocks) ── */
function FeatureRow({ title, desc, linkText, image, reverse = false }) {
  return (
    <div className="px-6 py-16 max-w-6xl mx-auto">
      <div
        className={`grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 lg:items-center ${
          reverse ? "lg:[&>*:first-child]:order-2" : ""
        }`}
      >
        <div>
          <h2
            className="text-[clamp(28px,7vw,42px)] font-black leading-[1.1] mb-6"
            style={{
              color: "#0F0F1E",
              fontFamily: "'Lora', serif",
              letterSpacing: "-0.01em",
            }}
          >
            {title}
          </h2>
          <p className="text-lg text-[#5A5A6E] leading-relaxed mb-6 max-w-md">
            {desc}
          </p>
          <a
            href="/signup"
            className="text-base font-bold underline underline-offset-2"
            style={{ color: B }}
          >
            {linkText}
          </a>
        </div>

        <div className="rounded-2xl overflow-hidden">
          <img
            src={image}
            alt={title}
            className="w-full h-full object-cover aspect-[4/3]"
          />
        </div>
      </div>
    </div>
  );
}

/* ── "But wait, there's more" colored feature cards ── */
function MoreFeatures() {
  const items = [
    { label: "Lesson Planner", icon: PenTool, color: "#0D9488" },
    { label: "Grading", icon: CheckCircle2, color: "#CA8A04" },
    { label: "Insights", icon: BarChart3, color: "#EF4444" },
    { label: "Worksheets", icon: BookOpen, color: "#22C55E" },
    { label: "Weekly Forecast", icon: CalendarDays, color: "#2563EB" },
  ];

  return (
    <div className="px-6 py-16 max-w-3xl mx-auto">
      <h2
        className="text-[clamp(30px,7vw,44px)] font-black leading-[1.05] text-center mb-10"
        style={{
          color: "#0F0F1E",
          fontFamily: "'Lora', serif",
          letterSpacing: "-0.01em",
        }}
      >
        But wait, there&rsquo;s more.
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {items.map(({ label, icon: Icon, color }) => (
          <a
            key={label}
            href="/signup"
            className="group flex flex-col justify-between h-32 rounded-2xl border-2 px-6 py-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl active:translate-y-0 active:shadow-md"
            style={{ borderColor: color }}
            onMouseEnter={(e) => (e.currentTarget.style.background = `${color}0D`)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <div className="flex items-center justify-between">
              <Icon
                size={26}
                style={{ color }}
                strokeWidth={2}
                className="transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6"
              />
              <ArrowRight
                size={20}
                className="text-[#9490A0] transition-all duration-300 group-hover:translate-x-1 group-hover:text-[#1A1A2E]"
              />
            </div>
            <span className="text-lg font-bold text-[#0F0F1E]">{label}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

/* ── "Get started for free" 3-step section ── */
function GetStartedSteps({ onGetStarted }) {
  const steps = [
    {
      title: "Create an account.",
      desc: "It's free to sign up. You'll pick your plan and add your subject details.",
    },
    {
      title: "Add your classes.",
      desc: "Add your class rosters and subjects. Akoro syncs with your school's timetable automatically.",
    },
    {
      title: "Generate your first lesson plan.",
      desc: "Pick a topic and let Akoro draft your first lesson plan, worksheet, and quiz in minutes.",
    },
  ];

  return (
    <div className="px-6 py-16 max-w-xl mx-auto">
      <p className="text-base font-semibold text-[#8A87A0] mb-4">
        Get started for free
      </p>

      <h2
        className="text-[clamp(30px,7vw,44px)] font-black leading-[1.12] mb-10"
        style={{
          color: "#0F0F1E",
          fontFamily: "'Lora', serif",
          letterSpacing: "-0.01em",
        }}
      >
        You&rsquo;re three steps away from a lighter lesson-planning load.
      </h2>

      <div className="flex flex-col gap-7 mb-10">
        {steps.map((s) => (
          <div key={s.title}>
            <p className="text-lg font-bold text-[#0F0F1E] mb-1.5">
              {s.title}
            </p>
            <p className="text-base text-[#5A5A6E] leading-relaxed">
              {s.desc}
            </p>
          </div>
        ))}
      </div>

      <button
        onClick={onGetStarted}
        className="w-full py-4 rounded-lg font-bold text-white text-base shadow-md hover:opacity-90 transition-opacity"
        style={{ background: B }}
      >
        Get started
      </button>
    </div>
  );
}

/* ── FAQ accordion section ── */
function FAQSection() {
  const faqs = [
    {
      q: "What does Akoro do for instructors?",
      a: "Akoro plans lessons, drafts worksheets, and auto-grades quizzes for you, then surfaces exactly which students are struggling before your next class.",
    },
    {
      q: "Does Akoro grade essay or short-answer questions?",
      a: "Yes — Akoro auto-grades multiple-choice instantly and flags short-answer and essay responses with a suggested grade for you to confirm.",
    },
    {
      q: "Can I edit AI-generated lesson plans?",
      a: "Absolutely. Every lesson plan, worksheet, and quiz Akoro drafts is fully editable before you assign it to your class.",
    },
    {
      q: "Does Akoro sync with my school's timetable?",
      a: "Yes — once your school is on Akoro, your classes and deadlines sync automatically to your weekly forecast.",
    },
    {
      q: "How much time will Akoro actually save me?",
      a: "Instructors report saving an average of 6+ hours a week on grading and lesson planning alone.",
    },
    {
      q: "Can I use Akoro without my school being signed up?",
      a: "Yes — you can create an individual instructor account for free and connect your school later if you'd like.",
    },
  ];
  const [open, setOpen] = useState(-1);

  return (
    <div className="px-6 py-16" style={{ background: "#F7F2EA" }}>
      <div className="max-w-2xl mx-auto">
        <h2
          className="text-[clamp(30px,7vw,44px)] font-black leading-[1.05] mb-10"
          style={{
            color: "#0F0F1E",
            fontFamily: "'Lora', serif",
            letterSpacing: "-0.01em",
          }}
        >
          Frequently Asked Questions
        </h2>

        <div className="flex flex-col gap-7">
          {faqs.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={item.q}>
                <button
                  onClick={() => setOpen(isOpen ? -1 : i)}
                  className="w-full flex items-start gap-3 text-left"
                >
                  <ChevronDown
                    size={20}
                    className={`shrink-0 mt-1 text-[#0F0F1E] transition-transform duration-300 ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  />
                  <span className="text-lg sm:text-xl font-bold text-[#0F0F1E] leading-snug">
                    {item.q}
                  </span>
                </button>
                <div
                  className="overflow-hidden transition-all duration-300 ease-in-out pl-8"
                  style={{
                    maxHeight: isOpen ? "160px" : "0px",
                    opacity: isOpen ? 1 : 0,
                  }}
                >
                  <p className="text-base text-[#5A5A6E] leading-relaxed pt-2">
                    {item.a}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Contact / support section ── */
function ContactSection({ onGetStarted }) {
  const blocks = [
    {
      title: "Search the help center",
      desc: "Find instant answers by searching our help center or browsing topics.",
      link: "Help center",
      href: "#",
    },
    {
      title: "Give us a ring",
      desc: "Monday through Friday from 8AM \u2013 6PM WAT.",
      link: "+234 800 000 0000",
      href: "tel:+2348000000000",
    },
    {
      title: "Explore the demo",
      desc: "Have a look around and see how easy using Akoro really is.",
      link: "See demo",
      href: "#",
    },
  ];

  return (
    <div className="px-6 py-16 text-center">
      <div className="max-w-md mx-auto flex flex-col gap-16 mb-14">
        {blocks.map((b) => (
          <div key={b.title}>
            <h3
              className="text-[clamp(24px,5vw,32px)] font-black mb-4"
              style={{
                color: "#0F0F1E",
                fontFamily: "'Lora', serif",
              }}
            >
              {b.title}
            </h3>
            <p className="text-base text-[#5A5A6E] leading-relaxed mb-3">
              {b.desc}
            </p>
            <a
              href={b.href}
              className="text-base font-bold underline underline-offset-2"
              style={{ color: B }}
            >
              {b.link}
            </a>
          </div>
        ))}
      </div>

      <button
        onClick={onGetStarted}
        className="w-full max-w-sm mx-auto py-4 rounded-lg font-bold text-white text-base shadow-md hover:opacity-90 transition-opacity block"
        style={{ background: B }}
      >
        Get started
      </button>
    </div>
  );
}

/* ── Dark stats / comparison closing section ── */
function StatsCompare() {
  return (
    <div
      className="px-6 py-16 text-center"
      style={{ background: `linear-gradient(180deg, ${B2} 0%, #3A12A8 100%)` }}
    >
      <div className="max-w-xl mx-auto">
        <h2
          className="text-[clamp(28px,7vw,42px)] font-black leading-[1.15] mb-14"
          style={{
            color: "#fff",
            fontFamily: "'Lora', serif",
            letterSpacing: "-0.01em",
          }}
        >
          See how Akoro stacks up for instructors.
        </h2>

        <div className="w-full h-px bg-white/20 mb-10" />

        <p
          className="text-[clamp(32px,8vw,48px)] font-black mb-3"
          style={{ color: "#fff", fontFamily: "'Lora', serif" }}
        >
          9 out of 10
        </p>
        <p className="text-lg text-white/75 mb-10">
          instructors would recommend Akoro.
        </p>

        <div className="w-full h-px bg-white/20 mb-10" />

        <p
          className="text-[clamp(32px,8vw,48px)] font-black mb-3"
          style={{ color: "#fff", fontFamily: "'Lora', serif" }}
        >
          6 hrs/week
        </p>
        <p className="text-lg text-white/75 mb-10">
          average time saved on grading and lesson planning.
        </p>

        <div className="w-full h-px bg-white/20 mb-14" />

        <button
          className="w-full max-w-xs mx-auto py-4 rounded-lg font-bold text-base shadow-md hover:opacity-90 transition-opacity block"
          style={{ background: "#fff", color: B2 }}
        >
          Compare Akoro
        </button>

        <p className="text-sm text-white/50 mt-14">
          Survey of 940 Akoro instructors, June 2026
        </p>
      </div>
    </div>
  );
}

function Hero({ onBookDemo, onHowItWorks }) {
  return (
    <div className="px-6 pt-6 pb-16 max-w-6xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 lg:items-center">
        {/* ── Left: copy + CTAs ── */}
        <div className="text-center lg:text-left">
          <h1
            className="text-[clamp(52px,16vw,88px)] lg:text-[clamp(52px,4.4vw,72px)] font-black leading-[0.95] mb-6"
            style={{
              color: "#0F0F1E",
              fontFamily: "'Lora', serif",
              letterSpacing: "-0.01em",
            }}
          >
            Teach, grade, and inspire like a pro
          </h1>

          <p className="text-lg text-[#5A5A6E] leading-relaxed max-w-lg mx-auto lg:mx-0 mb-10">
            Join 4,000+ instructors across Nigeria &amp; Africa saving hours
            every week with an AI that plans lessons, grades quizzes, and
            flags struggling students before it's too late.
          </p>

          <div className="flex flex-col gap-3 max-w-sm mx-auto lg:mx-0">
            <button
              onClick={onBookDemo}
              className="w-full py-4 rounded-lg font-bold text-white text-base shadow-md hover:opacity-90 transition-opacity"
              style={{ background: B }}
            >
              Start teaching free
            </button>
            <button
              onClick={onHowItWorks}
              className="w-full py-4 rounded-lg font-bold text-base border-2 hover:bg-[#F1EBFF] transition-colors"
              style={{ color: B, borderColor: B }}
            >
              How Akoro for Instructors works
            </button>
          </div>
        </div>

        {/* ── Right: product preview card ── */}
        <ProductPreviewCard />
      </div>
    </div>
  );
}

function FloatingHelpButton() {
  return (
    <button
      aria-label="Help"
      className="fixed bottom-6 left-6 z-40 w-12 h-12 rounded-full flex items-center justify-center text-white shadow-lg hover:scale-105 transition-transform"
      style={{ background: B2 }}
    >
      <MessageCircle size={22} />
    </button>
  );
}


export { B, B2, FontImport, AnnouncementBar, ProductPreviewCard, FeatureAccordion, TestimonialQuote, FeatureRow, MoreFeatures, GetStartedSteps, FAQSection, ContactSection, StatsCompare, Hero, FloatingHelpButton };
