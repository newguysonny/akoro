import React, { useState, useEffect, useRef } from "react";

const SLIDES = [
  {
    image:
      "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=900&h=950&fit=crop",
    text: "Where curiosity leads and community thrives",
  },
  {
    image:
      "https://images.unsplash.com/photo-1588072432836-e10032774350?w=900&h=950&fit=crop",
    text: "Joyful learning since 1966",
  },
  {
    image:
      "https://images.unsplash.com/photo-1509062522246-3755977927d7?w=900&h=950&fit=crop",
    text: "Nurturing kindness, creativity & excellence",
  },
];

const SLIDE_DURATION = 5000; // ms

export default function SFSHero() {
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
      <div className="flex justify-start bg-white pt-1 pb-8">
        <div
          className="relative w-full max-w-[640px] overflow-hidden"
          style={{
            aspectRatio: "18 / 16",
            borderRadius: "0 0 0 clamp(120px, 40vw, 260px)",
          }}
        >
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
        </div>
      </div>
    </div>
  );
}
