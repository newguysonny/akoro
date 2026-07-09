import React, { useRef, useState, useEffect } from "react";
import { ArrowRight } from "lucide-react";

/* ── Brand tokens (match Akoro landing page) ── */
const B2 = "#4C1DCC";

const SEGMENTS = [
  {
    image:
      "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=700&h=500&fit=crop",
    title: "Akoro For Learners & Students",
    features: ["AI Assessment", "AI Quizzes"],
    href: "#",
  },
  {
    image:
      "https://images.unsplash.com/photo-1580582932707-520aed937b7b?w=700&h=500&fit=crop",
    title: "Akoro For Instructors & Teachers",
    features: ["Lesson Planner", "Weekly Forecast", "Worksheets"],
    href: "#",
  },
  {
    image:
      "https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=700&h=500&fit=crop",
    title: "Akoro For Schools",
    features: [
      "Student Management",
      "Staff & Team Management",
      "Academic Management",
    ],
    href: "#",
  },
];

/* ── Scroll-reveal hook (fade + slide up, fires once) ── */
function useReveal(threshold = 0.15) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          obs.unobserve(el);
        }
      },
      { threshold, rootMargin: "0px 0px -40px 0px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, inView];
}

function SegmentCard({ image, title, features, href, delay = 0 }) {
  const [ref, inView] = useReveal();
  return (
    <a
      ref={ref}
      href={href}
      className="group relative flex-1 aspect-[16/9] lg:aspect-auto lg:h-[280px] flex flex-col items-center justify-center overflow-hidden border-[2.5px] border-white rounded-sm cursor-pointer"
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? "translateY(0)" : "translateY(36px)",
        transition: `opacity .8s cubic-bezier(.22,1,.36,1) ${delay}s, transform .8s cubic-bezier(.22,1,.36,1) ${delay}s`,
      }}
    >
      <img
        src={image}
        alt={title}
        className="absolute inset-0 w-full h-full object-cover"
      />
      {/* group-hover here reacts to hovering ANY part of the card, not just this layer */}
      <div className="absolute inset-0 bg-[#4C1DCC]/[.72] group-hover:bg-[#4C1DCC]/[.55] group-active:bg-[#4C1DCC]/[.85] transition-colors duration-300" />

      <div className="relative z-10 flex flex-col items-center text-center px-6 py-6 gap-4">
        <h3 className="text-white font-semibold leading-snug text-[clamp(19px,4.4vw,24px)] px-4">
          {title}
        </h3>

        <div className="flex flex-wrap justify-center gap-1.5">
          {features.map((f) => (
            <span
              key={f}
              className="text-[10px] font-semibold text-white/85 bg-white/10 border border-white/25 rounded-full px-2.5 py-1 leading-none"
            >
              {f}
            </span>
          ))}
        </div>

        <span className="inline-flex items-center gap-1 text-xs font-bold text-white group-hover:gap-2 group-active:scale-90 group-active:text-white/70 transition-all duration-150">
          Learn More <ArrowRight size={12} />
        </span>
      </div>
    </a>
  );
}

export default function QuickActions() {
  return (
    <section
      className="flex flex-col lg:flex-row gap-6 px-5 py-8 lg:px-12 lg:py-12 lg:max-w-[1100px] lg:mx-auto"
      style={{
        background: `linear-gradient(180deg, ${B2} 0%, #3A12A8 100%)`,
      }}
    >
      {SEGMENTS.map((s, i) => (
        <SegmentCard key={s.title} {...s} delay={i * 0.12} />
      ))}
    </section>
  );
}
