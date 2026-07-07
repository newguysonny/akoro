import React, { useRef, useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const NAVY = "#1B3E6F";

const NEWS_ITEMS = [
  {
    image:
      "https://images.unsplash.com/photo-1580582932707-520aed937b7b?w=900&h=600&fit=crop",
    category: "Campus Life",
    date: "May 12, 2026",
    title: "New STEM Lab Opens Doors to Hands-On Discovery",
  },
  {
    image:
      "https://images.unsplash.com/photo-1509062522246-3755977927d7?w=900&h=600&fit=crop",
    category: "Academics",
    date: "May 6, 2026",
    title: "8th Graders Present Capstone Innovation Projects",
  },
  {
    image:
      "https://images.unsplash.com/photo-1588072432836-e10032774350?w=900&h=600&fit=crop",
    category: "Community",
    date: "April 28, 2026",
    title: "Spring Art Walk Transforms Our Hallways",
  },
  {
    image:
      "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=900&h=600&fit=crop",
    category: "Athletics",
    date: "April 19, 2026",
    title: "Eagles Take the Regional Championship Title",
  },
];

function NewsCard({ image, category, date, title }) {
  return (
    <div
      className="relative shrink-0 snap-center rounded-2xl overflow-hidden cursor-pointer group
                 w-[83%] sm:w-[60%] md:w-[42%] lg:w-[32%] aspect-[4/3]"
    >
      <img
        src={image}
        alt={title}
        className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-5">
        <span
          className="inline-block text-[11px] font-bold uppercase tracking-wide text-white/85 mb-2 px-2.5 py-1 rounded-full"
          style={{ background: `${NAVY}CC` }}
        >
          {category}
        </span>
        <h3 className="text-white text-lg font-bold leading-snug mb-1">
          {title}
        </h3>
        <span className="text-white/70 text-xs">{date}</span>
      </div>
    </div>
  );
}

export default function NewsCarousel() {
  const trackRef = useRef(null);
  const [active, setActive] = useState(0);

  const scrollToIndex = useCallback((i) => {
    const el = trackRef.current;
    if (!el) return;
    const card = el.children[i];
    if (!card) return;
    const offset =
      card.offsetLeft - (el.clientWidth - card.clientWidth) / 2;
    el.scrollTo({ left: offset, behavior: "smooth" });
  }, []);

  const goPrev = () => scrollToIndex(Math.max(0, active - 1));
  const goNext = () =>
    scrollToIndex(Math.min(NEWS_ITEMS.length - 1, active + 1));

  // Sync active dot to nearest centered card while the user scrolls/swipes
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    let raf;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const center = el.scrollLeft + el.clientWidth / 2;
        let closest = 0;
        let closestDist = Infinity;
        Array.from(el.children).forEach((child, i) => {
          const childCenter = child.offsetLeft + child.clientWidth / 2;
          const dist = Math.abs(childCenter - center);
          if (dist < closestDist) {
            closestDist = dist;
            closest = i;
          }
        });
        setActive(closest);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section className="bg-white py-16 font-serif">
      <div className="relative">
        {/* Prev / Next arrows */}
        <button
          onClick={goPrev}
          aria-label="Previous"
          disabled={active === 0}
          className="hidden sm:flex absolute left-2 top-1/2 -translate-y-1/2 z-10 w-10 h-10 items-center justify-center rounded-full bg-white shadow-md disabled:opacity-30 transition-opacity"
          style={{ color: NAVY }}
        >
          <ChevronLeft size={22} />
        </button>
        <button
          onClick={goNext}
          aria-label="Next"
          disabled={active === NEWS_ITEMS.length - 1}
          className="hidden sm:flex absolute right-2 top-1/2 -translate-y-1/2 z-10 w-10 h-10 items-center justify-center rounded-full bg-white shadow-md disabled:opacity-30 transition-opacity"
          style={{ color: NAVY }}
        >
          <ChevronRight size={22} />
        </button>

        {/* Swipeable track */}
        <div
          ref={trackRef}
          className="flex gap-4 overflow-x-auto snap-x snap-mandatory scroll-smooth px-[8.5%] sm:px-[6%] md:px-[8%] lg:px-[6%]
                     [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
        >
          {NEWS_ITEMS.map((item, i) => (
            <NewsCard key={i} {...item} />
          ))}
        </div>
      </div>

      {/* Dot pagination */}
      <div className="flex items-center justify-center gap-2.5 mt-8">
        {NEWS_ITEMS.map((_, i) => (
          <button
            key={i}
            onClick={() => scrollToIndex(i)}
            aria-label={`Go to slide ${i + 1}`}
            className="w-2.5 h-2.5 rounded-full border transition-colors"
            style={{
              background: active === i ? NAVY : "transparent",
              borderColor: NAVY,
            }}
          />
        ))}
      </div>
    </section>
  );
}
