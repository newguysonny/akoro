import React, { useState, useEffect, useRef } from "react";
import {
  Menu,
  X,
  MessageCircle,
  CalendarDays,
  Flame,
  Star,
  ChevronDown,
  Repeat2,
  Trophy,
  Mic,
  BookOpen,
  WifiOff,
  ArrowRight,
  Target,
  Brain,
} from "lucide-react";
import { SiteNav, SFSHeader, SiteFooter } from '../components/SiteChrome.jsx';

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
        🎓 12,400+ students trust Akoro. See how they{" "}
        <a href="#" className="font-bold underline underline-offset-2">
          learn smarter
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

/* ── Product preview card: a student's own progress dashboard ── */
function StudentProgressCard() {
  return (
    <div className="relative max-w-md mx-auto lg:mx-0 lg:max-w-full">
      <div
        className="absolute -inset-8 rounded-[40px] blur-3xl opacity-40 -z-10"
        style={{ background: "linear-gradient(135deg,#D9CBFF,#F1EBFF)" }}
      />

      <div className="bg-white rounded-3xl shadow-2xl border border-[#EDE8F7] p-6 sm:p-7">
        <h3
          className="text-2xl font-extrabold text-[#0F0F1E] mb-1"
          style={{ fontFamily: "'Poppins', sans-serif" }}
        >
          Continue learning
        </h3>
        <p className="text-sm text-[#8A87A0] mb-5">Term 2 · Week 6</p>

        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-bold text-[#0F0F1E]">
            Further Mathematics
          </span>
          <span
            className="text-sm font-bold flex items-center gap-1 underline underline-offset-2"
            style={{ color: B }}
          >
            Step 2 of 4 <ChevronDown size={14} />
          </span>
        </div>
        <div className="h-2 rounded-full bg-[#EEE9F9] overflow-hidden mb-6">
          <div
            className="h-full rounded-full"
            style={{ width: "55%", background: B }}
          />
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="border border-[#EDE8F7] rounded-xl p-3 flex items-center gap-2.5">
            <Flame size={20} style={{ color: "#F59E0B" }} />
            <div>
              <div className="text-xs font-bold text-[#0F0F1E]">Streak</div>
              <div className="text-xs text-[#8A87A0]">4 days</div>
            </div>
          </div>
          <div className="border border-[#EDE8F7] rounded-xl p-3 flex items-center gap-2.5">
            <Star size={20} style={{ color: B }} />
            <div>
              <div className="text-xs font-bold text-[#0F0F1E]">XP earned</div>
              <div className="text-xs text-[#8A87A0]">320 XP</div>
            </div>
          </div>
        </div>

        <div className="border border-[#EDE8F7] rounded-xl px-4 py-3 flex items-center justify-between mb-4">
          <span className="text-sm font-bold text-[#0F0F1E]">
            Subjects mastered
          </span>
          <span className="text-sm font-extrabold text-[#0F0F1E] flex items-center gap-1">
            6 / 9 <ChevronDown size={14} className="text-[#8A87A0]" />
          </span>
        </div>

        <div className="border border-[#EDE8F7] rounded-xl overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3.5">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
              style={{ background: B2 }}
            >
              NA
            </div>
            <span className="font-bold text-sm text-[#0F0F1E]">
              Ngozi Adeyemi
            </span>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-dashed border-[#EDE8F7]">
            <span className="text-sm text-[#5A5A6E]">Quizzes completed</span>
            <span className="text-sm font-semibold text-[#0F0F1E]">
              18 / 20
            </span>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="text-sm text-[#5A5A6E]">Average score</span>
            <span className="text-sm font-semibold text-[#0F0F1E]">89%</span>
          </div>
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ background: "#F1EBFF" }}
          >
            <span className="text-sm font-bold text-[#0F0F1E]">
              Overall grade
            </span>
            <span className="text-sm font-extrabold" style={{ color: B }}>
              A
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Accordion feature section — the 4 core student features ── */
function FeatureAccordion() {
  const items = [
    {
      title: "Meet your AI protégé",
      desc: "Every student gets a dedicated AI agent — the more you teach it, the smarter it gets, and the better it teaches you back.",
      link: "Learn more about your AI protégé",
    },
    {
      title: "Get assessed the moment you're ready",
      desc: "Sargeant tests everything you've taught your agent and updates your confidence score in real time — before you forget it.",
      link: "Learn more about assessments",
    },
    {
      title: "Learning that goes both ways",
      desc: "Teach your agent a concept, then let NaNa Esumai guide it to teach you back. Two-way learning sticks twice as long.",
      link: "Learn more about bidirectional learning",
    },
    {
      title: "See exactly what you've mastered",
      desc: "One visual map for every subject — see what's solid, what's shaky, and what to study next.",
      link: "Learn more about your progress map",
    },
  ];
  const [open, setOpen] = useState(0);
  const [progress, setProgress] = useState(0);
  const AUTO_MS = 5000;
  const pausedRef = useRef(false);
  const elapsedRef = useRef(0);

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
        Master any subject with your own AI protégé.
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
                  href="#"
                  className="inline-block text-base font-bold underline underline-offset-2 pb-6"
                  style={{ color: B }}
                >
                  {item.link} →
                </a>
              </div>

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

/* ── Testimonial quote section ── */
function TestimonialQuote() {
  return (
    <div className="bg-[#F7F6FA] px-6 py-20">
      <div className="max-w-2xl mx-auto text-center">
        <p className="text-base font-bold text-[#8A87A0] tracking-wide mb-8">
          D7 to B2 in WASSCE Further Maths
        </p>

        <p
          className="text-[clamp(24px,6vw,38px)] font-black leading-[1.25] mb-10"
          style={{
            color: "#0F0F1E",
            fontFamily: "'Lora', serif",
          }}
        >
          &ldquo;I failed Further Maths twice before Akoro. The agent battles
          made me actually want to study. I passed with a B2 at
          WASSCE.&rdquo;
        </p>

        <p className="text-lg font-bold text-[#0F0F1E] mb-4">
          Chukwuemeka Obi
        </p>
        <div className="w-16 h-px bg-[#D8D4E5] mx-auto mb-4" />
        <p className="text-base text-[#5A5A6E] mb-8">SS3 Student, Lagos</p>

        <a
          href="#"
          className="text-base font-bold underline underline-offset-2"
          style={{ color: B }}
        >
          Read the full story
        </a>
      </div>
    </div>
  );
}

/* ── "But wait, there's more" colored feature cards — remaining student features ── */
function MoreFeatures() {
  const items = [
    { label: "Repetition", icon: Repeat2, color: "#0D9488" },
    { label: "Battles", icon: Trophy, color: "#CA8A04" },
    { label: "Multi-modal", icon: Mic, color: "#EF4444" },
    { label: "Curriculum", icon: BookOpen, color: "#22C55E" },
    { label: "Offline", icon: WifiOff, color: "#2563EB" },
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
            href="#"
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

/* ── How it works (same 4 steps as the main Akoro learning platform) + Pro Tip ── */
function HowItWorks() {
  const steps = [
    {
      num: "01",
      icon: Target,
      title: "Pick a topic",
      desc: "Choose from curriculum subjects or create your own. Set subtopics and learning objectives — your agent starts calibrated, not cold.",
    },
    {
      num: "02",
      icon: Brain,
      title: "Teach your agent",
      desc: "Explain concepts via chat or voice. NaNa Esumai guides every step — she listens, asks probing questions, and flags misconceptions in real time.",
    },
    {
      num: "03",
      icon: Repeat2,
      title: "Get assessed by Sargeant",
      desc: "Sargeant tests your agent on everything you taught. Your confidence score updates after every assessment — before you forget.",
    },
    {
      num: "04",
      icon: Trophy,
      title: "Rise the ranks",
      desc: "Climb classroom and inter-school leaderboards. Challenge friends, earn XP, and prove your knowledge in live battles.",
    },
  ];

  return (
    <div className="px-6 py-16 max-w-6xl mx-auto">
      <div className="text-center mb-12">
        <h2
          className="text-[clamp(30px,7vw,44px)] font-black leading-[1.05] mb-4"
          style={{
            color: "#0F0F1E",
            fontFamily: "'Lora', serif",
            letterSpacing: "-0.01em",
          }}
        >
          How it works
        </h2>
        <p className="text-lg text-[#5A5A6E] max-w-md mx-auto">
          Four simple steps that turn passive studying into active mastery.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
        {steps.map(({ num, icon: Icon, title, desc }) => (
          <div
            key={num}
            className="bg-white border border-[#EDE8F7] rounded-2xl p-6 transition-all duration-300 hover:-translate-y-1"
            style={{ boxShadow: "0 2px 12px rgba(0,0,0,.04)" }}
          >
            <div
              className="text-xs font-extrabold tracking-widest mb-4"
              style={{ color: B, fontFamily: "'Poppins', sans-serif" }}
            >
              STEP {num}
            </div>
            <Icon size={26} style={{ color: B }} className="mb-4" />
            <h3 className="text-base font-bold text-[#0F0F1E] mb-2 leading-snug">
              {title}
            </h3>
            <p className="text-sm text-[#5A5A6E] leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>

      {/* Pro Tip callout */}
      <div
        className="rounded-3xl p-8 sm:p-10 flex flex-col sm:flex-row items-center gap-8 justify-between"
        style={{
          border: `1px solid ${B}30`,
          background: `linear-gradient(140deg, ${B}0D, ${B}03)`,
        }}
      >
        <div className="text-center sm:text-left">
          <div
            className="text-xs font-extrabold tracking-widest mb-2"
            style={{ color: B, fontFamily: "'Poppins', sans-serif" }}
          >
            PRO TIP
          </div>
          <h3
            className="text-2xl font-black mb-2"
            style={{
              color: "#0F0F1E",
              fontFamily: "'Lora', serif",
            }}
          >
            Start with a free skill assessment
          </h3>
          <p className="text-base text-[#5A5A6E] leading-relaxed">
            5 minutes. Personalises your journey and boosts completion by up
            to 50%.
          </p>
        </div>

        <div className="flex items-center gap-8 shrink-0">
          <div className="text-center">
            <div
              className="text-2xl font-extrabold"
              style={{ color: B, fontFamily: "'Poppins', sans-serif" }}
            >
              50%
            </div>
            <div className="text-xs text-[#8A87A0] mt-1">completion lift</div>
          </div>
          <div className="text-center">
            <div
              className="text-2xl font-extrabold"
              style={{ color: B, fontFamily: "'Poppins', sans-serif" }}
            >
              5 min
            </div>
            <div className="text-xs text-[#8A87A0] mt-1">to personalise</div>
          </div>
          <button
            className="px-6 py-3 rounded-lg font-bold text-white text-sm shadow-md hover:opacity-90 transition-opacity whitespace-nowrap"
            style={{ background: B }}
          >
            Take free assessment
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── FAQ accordion section ── */
function FAQSection() {
  const faqs = [
    {
      q: "What does Akoro do?",
      a: "Akoro is an AI learning platform where you teach an AI agent a concept, and the agent teaches you back — right before you'd forget it.",
    },
    {
      q: "Do I need my school to sign up too?",
      a: "No — you can use Akoro on your own, for free, whether or not your school is on the platform. If your school joins later, your progress carries over automatically.",
    },
    {
      q: "What is Akoro used for?",
      a: "Studying smarter — teach your own AI agent, get instantly assessed, and see exactly what to revise next, all in one place.",
    },
    {
      q: "How much does it cost?",
      a: "Individual plans start free. Pro unlocks unlimited subjects, agent battles, and the full knowledge progress map.",
    },
    {
      q: "Does it work for WAEC, JAMB, and NECO?",
      a: "Yes — Akoro is aligned to WAEC, JAMB, NECO, Cambridge IGCSE/A-Level, KCSE, and IB curricula.",
    },
    {
      q: "Is it easy to get started?",
      a: "Yes — sign up, pick a subject, and start teaching your agent in under 5 minutes.",
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
          See how Akoro stacks up against other study apps.
        </h2>

        <div className="w-full h-px bg-white/20 mb-10" />

        <p
          className="text-[clamp(32px,8vw,48px)] font-black mb-3"
          style={{ color: "#fff", fontFamily: "'Lora', serif" }}
        >
          9 out of 10
        </p>
        <p className="text-lg text-white/75 mb-10">
          students would recommend Akoro.
        </p>

        <div className="w-full h-px bg-white/20 mb-10" />

        <p
          className="text-[clamp(32px,8vw,48px)] font-black mb-3"
          style={{ color: "#fff", fontFamily: "'Lora', serif" }}
        >
          89% retention
        </p>
        <p className="text-lg text-white/75 mb-10">
          vs 17% from passive video lessons.
        </p>

        <div className="w-full h-px bg-white/20 mb-14" />

        <button
          className="w-full max-w-xs mx-auto py-4 rounded-lg font-bold text-base shadow-md hover:opacity-90 transition-opacity block"
          style={{ background: "#fff", color: B2 }}
        >
          Compare Akoro
        </button>

        <p className="text-sm text-white/50 mt-14">
          Survey of 1,240 Akoro students and teachers, June 2026
        </p>
      </div>
    </div>
  );
}

function Hero({ onCreateAccount, onHowItWorks }) {
  return (
    <div className="px-6 pt-6 pb-16 max-w-6xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 lg:items-center">
        <div className="text-center lg:text-left">
          <h1
            className="text-[clamp(52px,16vw,88px)] lg:text-[clamp(52px,4.4vw,72px)] font-black leading-[0.95] mb-6"
            style={{
              color: "#0F0F1E",
              fontFamily: "'Lora', serif",
              letterSpacing: "-0.01em",
            }}
          >
            Learn, teach, and grow like a pro
          </h1>

          <p className="text-lg text-[#5A5A6E] leading-relaxed max-w-lg mx-auto lg:mx-0 mb-10">
            Join 12,400+ students building real mastery with an AI agent that
            teaches you back — right before you'd forget it.
          </p>

          <div className="flex flex-col gap-3 max-w-sm mx-auto lg:mx-0">
            <button
              onClick={onCreateAccount}
              className="w-full py-4 rounded-lg font-bold text-white text-base shadow-md hover:opacity-90 transition-opacity"
              style={{ background: B }}
            >
              Create free account
            </button>
            <button
              onClick={onHowItWorks}
              className="w-full py-4 rounded-lg font-bold text-base border-2 hover:bg-[#F1EBFF] transition-colors"
              style={{ color: B, borderColor: B }}
            >
              How Akoro works
            </button>
          </div>
        </div>

        <StudentProgressCard />
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

export default function StudentInfoPage() {
  const [showBanner, setShowBanner] = useState(true);

  return (
    <div className="min-h-screen bg-white overflow-hidden">
      <FontImport />
      {showBanner && <AnnouncementBar onDismiss={() => setShowBanner(false)} />}
      <SFSHeader />
     <Hero onCreateAccount={() => {}} onHowItWorks={() => {}} />
     <FeatureAccordion />
      <TestimonialQuote />
      <MoreFeatures />
      <HowItWorks />
      <FAQSection />
      <ContactSection onGetStarted={() => {}} />
      <StatsCompare />
      <FloatingHelpButton />
    </div>
  );
}
