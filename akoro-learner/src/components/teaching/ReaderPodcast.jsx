/**
 * ReaderPodcast — a generated study episode in the reader's result tab.
 *
 * `podcast` is the saved item's state from the server:
 *   making → the episode is being written and recorded (the reader polls)
 *   failed → { error }
 *   ready  → { title, audioUrl, turns:[{ speaker, text, cite }], segments, totalBytes }
 * The transcript follows the audio (the playing turn is highlighted); a
 * tap on a turn plays from there, and its source chip jumps the reader.
 */
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../common/Icons.jsx';
import { BRAND } from '../../constants.js';
import { citeLabel, toReaderCite } from '../../lib/askAnswer.js';
import { turnAt, turnStart, clock } from '../../lib/podcastTimeline.js';

const SPEAKER_COLOR = { Host: BRAND, Guest: '#0EA5E9' };

function SourceChip({ cite, onCite }) {
  const target = cite ? toReaderCite(cite) : null;
  if (!target) return null;
  return (
    <button type="button" className="folio-citation" title={cite.quote ? `“${cite.quote}”` : 'Jump to source'}
      onClick={(e) => { e.stopPropagation(); onCite({ ...target, quote: cite.quote }); }}>
      <Icon name={Number.isInteger(cite.pageNumber) ? 'ti-file-text' : 'ti-player-play'} size={10}/>
      {citeLabel(cite)}
    </button>
  );
}

export default function ReaderPodcast({ podcast, onCite, onRetry }) {
  const audioRef = useRef(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(NaN);
  const [playing, setPlaying] = useState(false);
  const status = podcast?.status || 'making';

  useEffect(() => { setTime(0); setDuration(NaN); setPlaying(false); }, [podcast?.audioUrl]);

  if (status === 'making') {
    return (
      <div className="rounded-lg p-4 flex items-start gap-3" style={{ background: 'var(--ak-surface)', border: '1px solid var(--ak-border2)' }} role="status">
        <span className="w-4 h-4 mt-0.5 rounded-full border-2 animate-spin flex-shrink-0" style={{ borderColor: 'var(--ak-border2)', borderTopColor: BRAND }}/>
        <div>
          <div className="text-sm font-semibold" style={{ color: 'var(--ak-text)' }}>Writing and recording your episode…</div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--ak-text-sub)' }}>
            This usually takes a minute or two. Keep reading — it will play right here when it's ready.
          </div>
        </div>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="rounded-lg p-4" style={{ background: 'var(--ak-surface)', border: '1px solid var(--ak-border2)' }} role="alert">
        <div className="text-sm font-semibold mb-1" style={{ color: 'var(--ak-danger-text)' }}>This episode couldn't be made</div>
        <div className="text-xs mb-3" style={{ color: 'var(--ak-text-sub)' }}>{podcast?.error || 'Something went wrong — try again.'}</div>
        {onRetry && (
          <button type="button" onClick={onRetry} className="folio-primary-btn text-xs font-semibold px-3 py-1.5 rounded-lg">
            Try again
          </button>
        )}
      </div>
    );
  }

  const turns = podcast?.turns || [];
  const segments = podcast?.segments || [];
  const current = turnAt(segments, podcast?.totalBytes, time, duration);

  const playFrom = (i) => {
    const a = audioRef.current;
    if (!a) return;
    if (Number.isFinite(a.duration)) a.currentTime = turnStart(segments, podcast.totalBytes, i, a.duration);
    a.play().catch(() => {});
  };

  return (
    <div>
      <div className="rounded-lg p-4 mb-3.5" style={{ background: 'var(--ak-surface)', border: '1px solid var(--ak-border2)' }}>
        <div className="font-display text-sm font-semibold mb-0.5" style={{ color: 'var(--ak-text)' }}>{podcast?.title || 'Study podcast'}</div>
        <div className="text-xs mb-3" style={{ color: 'var(--ak-text-sub)' }}>
          Two voices · {turns.length} parts{Number.isFinite(duration) ? ` · ${clock(duration)}` : ''}
        </div>
        {podcast?.audioUrl ? (
          <>
            <div className="flex items-center gap-2.5">
              <button type="button" aria-label={playing ? 'Pause' : 'Play'}
                onClick={() => { const a = audioRef.current; if (!a) return; if (a.paused) a.play().catch(() => {}); else a.pause(); }}
                className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: BRAND, color: '#fff' }}>
                <Icon name={playing ? 'ti-player-pause' : 'ti-player-play'} size={15}/>
              </button>
              <input type="range" min={0} max={Number.isFinite(duration) ? duration : 0} step={0.1} value={Math.min(time, Number.isFinite(duration) ? duration : 0)}
                aria-label="Seek"
                onChange={(e) => { const a = audioRef.current; if (a) a.currentTime = Number(e.target.value); }}
                className="flex-1" style={{ accentColor: BRAND }}/>
              <span className="font-ui-mono text-xs flex-shrink-0" style={{ color: 'var(--ak-text-sub)' }}>{clock(time)}</span>
              <a href={podcast.audioUrl} download={`${(podcast.title || 'podcast').replace(/[^\w -]/g, '').slice(0, 60) || 'podcast'}.mp3`}
                aria-label="Download episode" title="Download" className="folio-icon-btn w-8 h-8 rounded-full flex items-center justify-center">
                <Icon name="ti-download" size={15}/>
              </a>
            </div>
            <audio ref={audioRef} src={podcast.audioUrl} preload="metadata"
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
              onDurationChange={(e) => setDuration(e.currentTarget.duration)}
              onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
              onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}/>
          </>
        ) : (
          <div className="text-xs" style={{ color: 'var(--ak-danger-text)' }}>The audio couldn't be loaded — reopen the reader to try again.</div>
        )}
      </div>

      <div className="text-xs font-semibold mb-2" style={{ color: 'var(--ak-text-sub)' }}>Transcript</div>
      <ol className="flex flex-col gap-1.5" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {turns.map((t, i) => (
          <li key={i}>
            <div role="button" tabIndex={0} onClick={() => playFrom(i)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); playFrom(i); } }}
              aria-current={i === current ? 'true' : undefined}
              className="rounded-lg px-3 py-2 cursor-pointer text-sm leading-relaxed"
              style={{
                background: i === current ? 'rgba(108,59,255,.12)' : 'transparent',
                border: `1px solid ${i === current ? 'rgba(108,59,255,.35)' : 'transparent'}`,
                color: 'var(--ak-text-sec)',
              }}>
              <span className="text-xs font-bold mr-1.5" style={{ color: SPEAKER_COLOR[t.speaker] || BRAND }}>{t.speaker}</span>
              {t.text} <SourceChip cite={t.cite} onCite={onCite}/>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
