import React, { useRef, useEffect, useCallback, useState } from "react";

// Add a `logo` path (e.g. "/logos/salesforce.png") to use an image.
// Leave `logo` empty/undefined and it falls back to the text name automatically.
const PARTNER_LOGOS = [
  { name: "PAYSTACK", logo: "/partners/paystack.png" },
  { name: "VAAS", logo: "/partners/vaas.png" },
  { name: "KPEMU", logo: "/partners/kpemu.png" },
  { name: "Slack", logo: "" },
  { name: "Notion", logo: "" },
  { name: "Zoom", logo: "" },
  { name: "HubSpot", logo: "" },
  { name: "Dropbox", logo: "" },
  { name: "Zendesk", logo: "" },
  { name: "Asana", logo: "" },
];

// Add a `logo` path per school to use its real logo.
// Leave `logo` empty/undefined and it falls back to the school name as text.
const SCHOOLS = [
  { name: "Chrisland School", logo: "" },
  { name: "St. Francis Xavier", logo: "" },
  { name: "Greenwood House", logo: "" },
  { name: "Corona Schools", logo: "" },
  { name: "Whitesands School", logo: "" },
  { name: "Loyola Jesuit College", logo: "" },
];

function LogoMark({ name, logo, imgClassName, textClassName }) {
  const [failed, setFailed] = useState(false);
  const hasImage = Boolean(logo) && !failed;

  if (hasImage) {
    return (
      <img
        src={logo}
        alt={name}
        onError={() => setFailed(true)}
        className={imgClassName}
        draggable={false}
      />
    );
  }

  return <span className={textClassName}>{name}</span>;
}

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
      {loopLogos.map((item, i) => (
        <div
          key={`${item.name}-${i}`}
          className="shrink-0 flex items-center justify-center min-w-[140px] h-14"
        >
          <LogoMark
            name={item.name}
            logo={item.logo}
            imgClassName="max-h-10 max-w-[140px] w-auto object-contain grayscale opacity-70"
            textClassName="text-xl sm:text-2xl font-bold text-[#B3B3B3] whitespace-nowrap select-none"
          />
        </div>
      ))}
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
        className="inline-block mx-auto px-10 py-[18px] rounded-full bg-[#F5A94E] text-[#1A1A2E] font-extrabold text-sm sm:text-base uppercase tracking-wide shadow-[0_8px_24px_rgba(245,169,78,0.4)] transition-transform duration-200 hover:-translate-y-0.5"
      >
        Request a personalized demo
      </button>

      <p className="mt-8 mb-10 text-sm sm:text-base font-semibold uppercase tracking-wide text-[#8A8A8A]">
        Trusted by Teachers, Instructors and Students at top Schools
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-10 max-w-2xl mx-auto items-center">
        {SCHOOLS.map((item) => (
          <div key={item.name} className="flex items-center justify-center h-16">
            <LogoMark
              name={item.name}
              logo={item.logo}
              imgClassName="max-h-14 max-w-[160px] w-auto object-contain"
              textClassName="text-xl sm:text-2xl font-extrabold text-[#9B9B9B] text-center leading-tight"
            />
          </div>
        ))}
      </div>
    </section>
  );
}
