import React from "react";
import { Brain, Swords, Repeat2, BarChart3, Mic, School } from "lucide-react";

/* ── Brand tokens (match Akoro landing page) ── */
const B = "#6C3BFF";
const B2 = "#4C1DCC";
const GL = "#F59E0B";

const SERVICES = [
  { icon: Brain, label: "Bidirectional AI Learning" },
  { icon: Swords, label: "Agent Battles" },
  { icon: Repeat2, label: "Spaced Repetition" },
  { icon: BarChart3, label: "Knowledge Progress Map" },
  { icon: Mic, label: "Multi-modal Input" },
  { icon: School, label: "School Dashboard" },
];

export default function AILearningBanner({ onStart }) {
  return (
    <section
      className="py-16 px-6 font-sans"
      style={{
        background: `linear-gradient(180deg, ${B2} 0%, #3A12A8 100%)`,
      }}
    >
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        {/* ── Left: copy ── */}
        <div className="text-center lg:text-left">
          <h2 className="text-3xl sm:text-4xl font-extrabold leading-tight mb-5">
            <span className="text-white">An AI Learning Companion for the</span>{" "}
            <span style={{ color: GL }}>Whole Curriculum</span>
          </h2>

          <p className="text-white/70 text-base leading-relaxed mb-3 max-w-lg mx-auto lg:mx-0">
            Akoro isn't another passive video course. Teach your AI agent a
            concept, and it teaches you back — right when you're about to
            forget it.
          </p>
          <p className="text-white/70 text-base leading-relaxed mb-8 max-w-lg mx-auto lg:mx-0">
            We believe every student deserves a learning experience built for
            how their brain actually works — whatever subject, whatever
            school, wherever they are.
          </p>

          <button
            onClick={onStart}
            className="inline-flex items-center gap-2 px-7 py-3 rounded-full bg-white font-bold text-sm uppercase tracking-wide shadow-md hover:-translate-y-0.5 transition-transform"
            style={{ color: B2 }}
          >
            Start Learning Free
          </button>
        </div>

        {/* ── Right: service grid (same glass-card style as QuickInfo) ── */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {SERVICES.map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex flex-col items-center justify-center text-center gap-3 rounded-2xl px-4 py-7 border border-white/20 bg-white/10 backdrop-blur-md transition-transform hover:-translate-y-1 cursor-default"
            >
              <Icon size={30} className="text-[#C4B5FD]" strokeWidth={1.75} />
              <span className="text-sm font-bold text-white">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
