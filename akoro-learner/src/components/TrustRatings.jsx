import React, { useRef, useEffect, useCallback } from "react";
import { Star } from "lucide-react";

const PLATFORMS = [
  { name: "g2.com", score: "5/5", stars: 5, tracking: "" },
  { name: "Google", score: "4.9/5", stars: 4.9, tracking: "" },
  { name: "FACEBOOK", score: "5/5", stars: 5, tracking: "tracking-[0.12em]" },
  { name: "Capterra", score: "4.8/5", stars: 4.8, tracking: "" },
];

const PARTNER_LOGOS = [
  "Salesforce",
  "Slack",
  "Notion",
  "Zoom",
  "HubSpot",
  "Dropbox",
  "Zendesk",
  "Asana",
];

function PartnerCarousel() {
  const trackRef = useRef(null);
  const pausedRef = useRef(false);
  const resumeTimeout = useRef(null);

  // Duplicate the list so the loop feels seamless
  const loopLogos = [...PARTNER_LOGOS, ...PARTNER_LOGOS];

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;

    let raf;
    const speed = 0.6; // px per frame, ~36px/s at 60fps

    const step = () => {
      if (!pausedRef.current && el) {
        el.scrollLeft += speed;
        const half = el.scrollWidth / 2;
        if (el.scrollLeft >= half) {
          el.scrollLeft -= half;
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  const pause = useCallback(() => {
    pausedRef.current = true;
    if (resumeTimeout.current) clearTimeout(resumeTimeout.current);
  }, []);

  const resumeSoon = useCallback(() => {
    if (resumeTimeout.current) clearTimeout(resumeTimeout.current);
    resumeTimeout.current = setTimeout(() => {
      pausedRef.current = false;
    }, 1500);
  }, []);

  return (
    <div
      ref={trackRef}
      onMouseEnter={pause}
      onMouseLeave={resumeSoon}
      onTouchStart={pause}
      onTouchEnd={resumeSoon}
      className="flex gap-10 overflow-x-auto px-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
    >
      {loopLogos.map((name, i) => (
        <div
          key={`${name}-${i}`}
          className="shrink-0 flex items-center justify-center min-w-[140px] h-14"
        >
          <span className="text-xl sm:text-2xl font-bold text-[#B3B3B3] whitespace-nowrap select-none">
            {name}
          </span>
        </div>
      ))}
    </div>
  );
}

function StarRow({ stars }) {
  return (
    <div className="flex justify-center gap-1">
      {[...Array(5)].map((_, i) => {
        const fillPct = Math.max(0, Math.min(1, stars - i)) * 100;
        return (
          <div key={i} className="relative w-6 h-6 sm:w-7 sm:h-7">
            <Star
              size={28}
              className="absolute inset-0 w-full h-full text-[#E5E1D8]"
              fill="#E5E1D8"
              strokeWidth={0}
            />
            <div
              className="absolute inset-0 overflow-hidden"
              style={{ width: `${fillPct}%` }}
            >
              <Star
                size={28}
                className="w-full h-full text-[#F5B84D]"
                fill="#F5B84D"
                strokeWidth={0}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function TrustRatings({ onDemo }) {
  return (
    <section className="bg-[#EEECE3] py-16 px-6 text-center font-sans">
      <div className="flex items-center justify-center gap-2 mb-6">
        <div className="w-5 h-0.5 bg-[#F5A94E]" />
        <span className="text-xs font-bold tracking-[0.14em] uppercase text-[#8A8A8A]">
          Partners &amp; Community
        </span>
        <div className="w-5 h-0.5 bg-[#F5A94E]" />
      </div>

      <div className="max-w-xl mx-auto mb-10">
        <PartnerCarousel />
      </div>

      <button
        onClick={onDemo}
        className="inline-block mx-auto mb-14 px-10 py-[18px] rounded-full bg-[#F5A94E] text-[#1A1A2E] font-extrabold text-sm sm:text-base uppercase tracking-wide shadow-[0_8px_24px_rgba(245,169,78,0.4)] transition-transform duration-200 hover:-translate-y-0.5"
      >
        Request a personalized demo
      </button>

      <div className="grid grid-cols-2 gap-x-6 gap-y-12 max-w-md mx-auto">
        {PLATFORMS.map((p) => (
          <div key={p.name}>
            <div
              className={`text-2xl sm:text-3xl font-extrabold text-[#9B9B9B] mb-4 ${p.tracking}`}
            >
              {p.name}
            </div>
            <div className="mb-2">
              <StarRow stars={p.stars} />
            </div>
            <div className="text-lg sm:text-xl text-[#1A1A2E] font-medium">
              {p.score}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
