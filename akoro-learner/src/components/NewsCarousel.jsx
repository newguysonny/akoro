import React, { useRef, useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { listPosts } from "../services/contentApi.js";

const NAVY = "#1B3E6F";

const fmtDate = (d) => {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  } catch { return ""; }
};

const CARD_W = "shrink-0 snap-center w-[83%] sm:w-[60%] md:w-[42%] lg:w-[32%] aspect-[4/3]";

function NewsCard({ image, category, date, title, href }) {
  const cls = `relative ${CARD_W} rounded-2xl overflow-hidden cursor-pointer group block no-underline`;
  const inner = (
    <>
      <img
        src={image}
        alt={title}
        loading="lazy"
        decoding="async"
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
        <h3 className="text-white text-lg font-bold leading-snug mb-1">{title}</h3>
        <span className="text-white/70 text-xs">{date}</span>
      </div>
    </>
  );
  return href ? <a href={href} className={cls}>{inner}</a> : <div className={cls}>{inner}</div>;
}

const SkeletonCard = () => (
  <div className={`${CARD_W} rounded-2xl bg-gray-100 animate-pulse`} />
);

export default function NewsCarousel() {
  const sectionRef = useRef(null);
  const trackRef = useRef(null);
  const [active, setActive] = useState(0);
  const [items, setItems] = useState(null);   // null = still loading
  const [inView, setInView] = useState(false);

  // Lazy: only reach for the API once the carousel scrolls near the viewport.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) { setInView(true); io.disconnect(); } },
      { rootMargin: "300px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Always the blog backend — no mock data.
  useEffect(() => {
    if (!inView) return;
    let cancelled = false;
    listPosts({ limit: 8 })
      .then((posts) => {
        if (cancelled) return;
        setItems((Array.isArray(posts) ? posts : []).map((p) => ({
          image: p.image,
          category: p.category || "News",
          date: fmtDate(p.published_at),
          title: p.title,
          href: p.slug ? `/blog/${p.slug}` : undefined,
        })));
      })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [inView]);

  const count = items?.length ?? 0;

  const scrollToIndex = useCallback((i) => {
    const el = trackRef.current;
    if (!el) return;
    const card = el.children[i];
    if (!card) return;
    el.scrollTo({ left: card.offsetLeft - (el.clientWidth - card.clientWidth) / 2, behavior: "smooth" });
  }, []);

  const goPrev = () => scrollToIndex(Math.max(0, active - 1));
  const goNext = () => scrollToIndex(Math.min(count - 1, active + 1));

  // Sync active dot to the nearest centered card while the user scrolls/swipes.
  useEffect(() => {
    const el = trackRef.current;
    if (!el || !count) return;
    let raf;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const center = el.scrollLeft + el.clientWidth / 2;
        let closest = 0, closestDist = Infinity;
        Array.from(el.children).forEach((child, i) => {
          const dist = Math.abs(child.offsetLeft + child.clientWidth / 2 - center);
          if (dist < closestDist) { closestDist = dist; closest = i; }
        });
        setActive(closest);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { el.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, [count]);

  // Loaded and empty → render nothing (no empty carousel block).
  if (items && count === 0) return null;

  const loading = items === null;

  return (
    <section ref={sectionRef} className="bg-white py-16 font-serif">
      <div className="relative">
        {!loading && (
          <>
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
              disabled={active === count - 1}
              className="hidden sm:flex absolute right-2 top-1/2 -translate-y-1/2 z-10 w-10 h-10 items-center justify-center rounded-full bg-white shadow-md disabled:opacity-30 transition-opacity"
              style={{ color: NAVY }}
            >
              <ChevronRight size={22} />
            </button>
          </>
        )}

        <div
          ref={trackRef}
          className="flex gap-4 overflow-x-auto snap-x snap-mandatory scroll-smooth px-[8.5%] sm:px-[6%] md:px-[8%] lg:px-[6%]
                     [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
        >
          {loading
            ? Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
            : items.map((item, i) => <NewsCard key={i} {...item} />)}
        </div>
      </div>

      {!loading && count > 1 && (
        <div className="flex items-center justify-center gap-2.5 mt-8">
          {items.map((_, i) => (
            <button
              key={i}
              onClick={() => scrollToIndex(i)}
              aria-label={`Go to slide ${i + 1}`}
              className="w-2.5 h-2.5 rounded-full border transition-colors"
              style={{ background: active === i ? NAVY : "transparent", borderColor: NAVY }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
