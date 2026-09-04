import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

const SLIDES = [
  {
    image:
      "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=900&h=950&fit=crop",
    text: "Teach your AI agent. Actually learn it.",
  },
  {
    image:
      "https://images.unsplash.com/photo-1588072432836-e10032774350?w=900&h=950&fit=crop",
    text: "Learn by teaching — your agent grows as you do.",
  },
  {
    image:
      "https://images.unsplash.com/photo-1509062522246-3755977927d7?w=900&h=950&fit=crop",
    text: "Your agent is waiting. Start learning for real.",
  },
];

const SLIDE_DURATION = 5000; // ms

export default function SFSHero() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState(0);
  const [prev, setPrev] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setCurrent((c) => {
        setPrev(c);
        return (c + 1) % SLIDES.length;
      });
    }, SLIDE_DURATION);
    return () => clearInterval(timerRef.current);
  }, []);

  // clear the "prev" slide after its exit animation
  useEffect(() => {
    if (prev === null) return;
    const t = setTimeout(() => setPrev(null), 700);
    return () => clearTimeout(t);
  }, [prev]);

  return (
    <div className="font-sans text-[#333]">
      {/* On phones the hero is a tall 18:16 card. From tablet up it spans the
          full width to the right edge — capping it at 640px left a dead gutter
          on the right of every desktop screen — so the aspect ratio gives way
          to a viewport-relative height. */}
      <style>{`
        .ak-sfs-hero {
          aspect-ratio: 18 / 16;
          max-width: 640px;
          border-radius: 0 0 0 clamp(120px, 40vw, 260px);
        }
        @media (min-width: 768px) {
          .ak-sfs-hero {
            max-width: none;
            aspect-ratio: auto;
            height: clamp(440px, 62vh, 640px);
            border-radius: 0 0 0 clamp(160px, 18vw, 300px);
          }
        }
      `}</style>
      <div className="flex justify-start bg-white pt-1 pb-8">
        <div className="ak-sfs-hero relative w-full overflow-hidden">
          {SLIDES.map((slide, i) => {
            const isCurrent = i === current;
            const isPrev = i === prev;
            if (!isCurrent && !isPrev) return null;

            return (
              <div
                key={i}
                className="absolute inset-0 transition-all duration-700 ease-in-out"
                style={{
                  transform: isCurrent ? "translateX(0)" : "translateX(-100%)",
                  opacity: isCurrent ? 1 : 0,
                  zIndex: isCurrent ? 2 : 1,
                }}
              >
                <img
                  src={slide.image}
                  alt=""
                  className="w-full h-full object-cover block"
                />
                <div className="absolute inset-0 flex items-center justify-center px-8">
                  <h1
                    className="text-white font-extrabold uppercase text-center leading-[1.1] tracking-tight"
                    style={{
                      fontSize: "clamp(1.35rem, 6vw, 3rem)",
                      textShadow: "0 2px 10px rgba(0,0,0,0.45)",
                    }}
                  >
                    {slide.text}
                  </h1>
                </div>
              </div>
            );
          })}

          {/* Persistent CTA over the hero (does not animate with the slides) */}
          <div className="absolute inset-x-0 bottom-0 z-10 flex justify-center px-8 pb-7">
            <button
              onClick={() => navigate("/signup")}
              className="inline-flex items-center gap-2 rounded-full font-extrabold text-white transition-transform hover:-translate-y-0.5"
              style={{
                background: "#6C3BFF",
                padding: "13px 28px",
                fontSize: "clamp(0.95rem, 2.5vw, 1.05rem)",
                boxShadow: "0 10px 28px rgba(108,59,255,0.45)",
              }}
            >
              Start free →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
