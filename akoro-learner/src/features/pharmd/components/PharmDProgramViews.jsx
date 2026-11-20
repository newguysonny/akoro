/**
 * PharmDProgramViews.jsx — the two programme views (browse and course
 * folder), split verbatim out of PharmDProgram. The props are the same
 * names the inline JSX already used, so nothing about the rendered
 * markup changes.
 */
import { BRAND } from '../../../constants.js';
import { Icon } from '../../../components/common/Icons.jsx';
import Spinner from '../../../components/common/Spinner.jsx';
import { AUTHOR, accentFor } from '../lib/pharmdData.js';
import { topicMeta } from '../lib/pharmdUi.js';

export function BrowseView({ meta, years, loadErr, setYears, setLoadErr, openCourse, soon, onClose, comingSoon = false }) {
  return (
          <div>
            <div className="pd-hero">
              <button className="pd-back" aria-label="Back to Discover" onClick={onClose}>←</button>
              <h1>{meta.name}</h1>
              <div className="pd-sub">{meta.sub}</div>
            </div>
            {comingSoon && (
              <div className="pd-section">
                <div style={{ margin: '0 22px', background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', borderRadius: 16, padding: '18px 16px' }}>
                  <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--ak-text)' }}>Coming soon</div>
                  <p style={{ margin: '6px 0 0', fontSize: 12.5, lineHeight: 1.55, color: 'var(--ak-text-sub)' }}>
                    {meta.name} materials are being prepared. Course folders, topics and teaching sessions
                    will appear here exactly like the pharmacy programme once they are published.
                  </p>
                </div>
              </div>
            )}
            {!comingSoon && years === null && !loadErr && (
              <div className="pd-state"><Spinner size={18} color={BRAND}/> Loading the programme…</div>
            )}
            {!comingSoon && loadErr && (
              <div className="pd-state">
                <div>Could not load the programme — check your connection.</div>
                <button onClick={() => { setYears(null); setLoadErr(false); }}
                  style={{ padding: '9px 18px', borderRadius: 20, border: 'none', background: BRAND, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Try again
                </button>
              </div>
            )}
            {!comingSoon && (years ?? []).map((year) => (
              <div className="pd-section" key={year.label}>
                <h2>{year.label}</h2>
                {year.courses?.length ? (
                  <div className="pd-row">
                    {year.courses.map((c) => (
                      <div key={c.id || c.code} className="pd-card" role="button" tabIndex={0}
                        onClick={() => openCourse(c.code)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCourse(c.code); } }}>
                        <span className="pd-art" style={{ background: accentFor(c.code) }}>
                          <span className="pd-upload" role="button" aria-label={`Set cover photo for ${c.code}`}
                            onClick={(e) => { e.stopPropagation(); soon('Custom covers'); }}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); soon('Custom covers'); } }}><Icon name="ti-camera" size={12}/></span>
                          <span className="pd-code">{c.code}</span>
                        </span>
                        <div className="pd-name">{c.title || c.code}</div>
                        <div className="pd-meta">Course. by {AUTHOR}</div>
                        <div className="pd-reads">{c.topics} topic{c.topics === 1 ? '' : 's'}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="pd-empty"><div className="pd-empty-card">Courses for {year.label} are coming soon.</div></div>
                )}
              </div>
            ))}
          </div>
  );
}

export function FolderView({ code, meta, courseData, topics, courseLoading, openCourse, startLearning, soon, setSheet, openTopic, isDone }) {
  return (
          <div>
            <div className="pd-folder-hero">
              <button className="pd-back" aria-label="Back to programme" onClick={() => openCourse(null)}>←</button>
              <div className="pd-folder-art" style={{ background: accentFor(code) }}>
                <span className="pd-upload" role="button" aria-label="Set cover photo"
                  onClick={() => soon('Custom covers')}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') soon('Custom covers'); }}><Icon name="ti-camera" size={14}/></span>
                <span className="pd-code-big">{code}</span>
              </div>
              <h2 className="pd-folder-title">{courseData?.course?.title || code}</h2>
              <div className="pd-author-row">
                <span className="pd-author-avatar" style={{ background: accentFor(code) }}>{AUTHOR.charAt(0)}</span>
                <span className="pd-author-name">{AUTHOR}</span>
              </div>
              <p className="pd-folder-meta">{topics.length} topics · {meta.name}</p>
              <div className="pd-action-row">
                <button className="pd-start" onClick={startLearning} disabled={!topics.length}>Start learning</button>
                <button className="pd-icon-btn" aria-label="Download all topics" onClick={() => soon('Offline downloads')}><Icon name="ti-download" size={18}/></button>
                <button className="pd-icon-btn" aria-label="More" onClick={() => setSheet({ kind: 'course' })}><Icon name="ti-dots-vertical" size={20}/></button>
              </div>
            </div>
            <div className="pd-topic-list">
              {courseLoading && <div className="pd-state"><Spinner size={16} color={BRAND}/> Loading topics…</div>}
              {!courseLoading && !courseData && (
                <div className="pd-state">
                  <div>Could not load the topics.</div>
                  <button onClick={() => openCourse(code)}
                    style={{ padding: '9px 18px', borderRadius: 20, border: 'none', background: BRAND, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Try again
                  </button>
                </div>
              )}
              {!courseLoading && courseData && !topics.length && (
                <div className="pd-empty"><div className="pd-empty-card">Topics for {courseData.course?.title || code} are being prepared — check back soon.</div></div>
              )}
              {topics.map((t, i) => (
                <div key={t.id || i} className="pd-topic-row" role="button" tabIndex={0}
                  onClick={() => openTopic(i)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTopic(i); } }}>
                  <div className="pd-topic-num">{i + 1}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="pd-t-name">{t.title}</div>
                    <div className="pd-t-meta">{topicMeta(t)}</div>
                  </div>
                  <div className={`pd-check${isDone(i) ? ' done' : ''}`}>{isDone(i) ? '✓' : ''}</div>
                  <button className="pd-more" aria-label={`More for ${t.title}`}
                    onClick={(e) => { e.stopPropagation(); setSheet({ kind: 'topic', idx: i }); }}><Icon name="ti-dots-vertical" size={16}/></button>
                </div>
              ))}
            </div>
          </div>
  );
}
