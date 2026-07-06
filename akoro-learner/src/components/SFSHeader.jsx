import React from "react";
import AkoroLogo from './common/AkoroLogo.jsx';


export default function SFSHeader() {
  return (
    <div className="font-sans text-[#333]">
      {/* ---------- UTILITY BAR ---------- */}
      <div className="flex items-center h-10 bg-[#2D2D2D] px-4">
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline text-xs text-gray-300 font-medium">
            Translate
          </span>
          <div className="flex gap-1.5 text-base leading-none">
            <span>🇺🇸</span>
            <span>🇲🇽</span>
            <span>🇨🇳</span>
          </div>
        </div>
        <div className="flex-1" />
        <button className="h-10 px-5 text-xs font-bold tracking-wide text-white bg-[#F5A623]">
          Inquire
        </button>
        <button className="h-10 px-5 text-xs font-bold tracking-wide text-white bg-[#0D9488]">
          Donate
        </button>
      </div>

      {/* ---------- HEADER (nav + logo) ---------- */}
      <div className="relative">
        <nav
          className="flex items-center justify-end h-[76px] sm:h-[88px] gap-[10px] bg-white pr-4 sm:pr-6"
          style={{ paddingLeft: "calc(38% + 6px)" }}
        >
          <button aria-label="Search" className="p-1">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              strokeWidth={2.2}
              strokeLinecap="round"
              className="w-[22px] h-[22px] stroke-[#C4164A]"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>

          <button className="bg-[#C4164A] text-white rounded-full px-6 py-[11px] text-[13px] font-bold tracking-wide uppercase whitespace-nowrap">
            Apply Now
          </button>

          <button aria-label="Menu" className="flex flex-col gap-[5px] p-1.5">
            <span className="block w-[26px] h-[3px] rounded bg-[#C4164A]" />
            <span className="block w-[26px] h-[3px] rounded bg-[#C4164A]" />
            <span className="block w-[26px] h-[3px] rounded bg-[#C4164A]" />
          </button>
        </nav>

        {/* Logo panel – positioned absolutely within this relative container */}
        <div
          className="absolute top-0 left-0 z-20 flex flex-col items-center justify-center bg-white px-1.5 py-2.5"
          style={{
            width: "calc(34% + 6px)",
            height: "clamp(130px, 32vw, 180px)",
            borderRadius: "0 0 32px 0",
            boxShadow: "2px 2px 10px rgba(0,0,0,0.06)",
          }}
        >
          <AkoroLogo size={34} radius={10}/>
          
          {/*
          <div className="grid grid-cols-2 grid-rows-2 gap-0.5 w-11 h-11 mb-1.5">
            <div className="bg-[#F5A623]" style={{ borderRadius: "100% 0 0 0" }} />
            <div className="bg-[#C4164A]" style={{ borderRadius: "0 100% 0 0" }} />
            <div className="bg-[#0D9488]" style={{ borderRadius: "0 0 0 100%" }} />
            <div className="bg-[#F5A623]" style={{ borderRadius: "0 0 100% 0" }} />
          </div>
          */}
          
          <div className="text-center leading-[1.25]">
            <div className="text-[9px] font-bold text-[#2D2D2D] tracking-wide">
              AI POWERED
            </div>
            <div className="text-[11px] font-extrabold text-[#2D2D2D] tracking-wide">
              ADAPTIVE LEARNING
            </div>
            <div className="text-[9px] font-bold text-[#2D2D2D] tracking-wide">
              PLATFORM
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
