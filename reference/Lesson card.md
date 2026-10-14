import React from "react";

/* ---------- Icons ---------- */
const PlayIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white" aria-hidden="true">
    <path d="M8 5v14l11-7z" />
  </svg>
);

const PlaylistIcon = () => (
  <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white" aria-hidden="true">
    <path d="M3 6h14v2H3zm0 4h14v2H3zm0 4h9v2H3zm13 0v6l5-3z" />
  </svg>
);

/* ---------- Shared shell ---------- */
function CardShell({ label, title, subtitle, duration, thumbnail }) {
  return (
    <article className="flex w-full items-center gap-5 rounded-lg bg-[#13233f] p-4 text-white shadow-md transition hover:bg-[#182b4d] sm:gap-6 sm:p-5">
      {thumbnail}

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-4">
          <span className="text-xs font-extrabold uppercase tracking-wide text-[#3d8bda]">
            {label}
          </span>
          <span className="shrink-0 text-sm text-slate-300">{duration}</span>
        </div>

        <h3 className="mt-2 truncate text-lg font-bold sm:text-xl">{title}</h3>
        <p className="mt-2 truncate text-sm text-slate-300 sm:text-base">
          {subtitle}
        </p>
      </div>
    </article>
  );
}

/* ---------- Topic card (playlist thumbnail with count) ---------- */
export function TopicCard({
  title = "Phases of Mitosis",
  subtitle = "11. Cell Division",
  duration = "49 minutes",
  count = 21,
  image,
}) {
  return (
    <CardShell
      label="Topic"
      title={title}
      subtitle={subtitle}
      duration={duration}
      thumbnail={
        <div className="relative h-24 w-40 shrink-0 overflow-hidden rounded-xl bg-slate-200 sm:h-28 sm:w-48">
          {image && (
            <img src={image} alt="" className="h-full w-full object-cover" />
          )}
          {/* count overlay */}
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/30">
            <PlaylistIcon />
            <span className="text-2xl font-medium">{count}</span>
          </div>
        </div>
      }
    />
  );
}

/* ---------- Concept / module card (video thumbnail with play button) ---------- */
export function ConceptCard({
  title = "Introduction to Biology",
  subtitle = "1. Introduction to Biology",
  duration = "3 minutes",
  image,
}) {
  return (
    <CardShell
      label="Concept"
      title={title}
      subtitle={subtitle}
      duration={duration}
      thumbnail={
        <div className="relative h-24 w-40 shrink-0 overflow-hidden rounded-xl bg-slate-100 sm:h-28 sm:w-48">
          {image && (
            <img src={image} alt="" className="h-full w-full object-cover" />
          )}
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-700/80">
              <PlayIcon />
            </span>
          </div>
        </div>
      }
    />
  );
}

/* ---------- Demo ---------- */
export default function LessonCardsDemo() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 bg-[#0e1b33] p-6">
      <ConceptCard />
      <TopicCard />
    </div>
  );
}
