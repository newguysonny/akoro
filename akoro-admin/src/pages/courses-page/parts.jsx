/**
 * CoursesPage — constants + child components.
 */
import { useState, useEffect, useCallback } from 'react';
import { BookOpen, Search, Trash2, ChevronDown, ChevronUp, DollarSign } from 'lucide-react';
import { PageLayout } from '../../components/Layout.jsx';
import { Btn, Modal, Toast, Skeleton, Inp } from '../../components/Primitives.jsx';
import useAdminAPI from '../../hooks/useAdminAPI.js';
import { apiGet, apiPatch } from '../../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, PURPLE, FONT } from '../../constants.js';


function StatusPill({ status }) {
  const map = {
    published: { bg: '#DCFCE7', color: GREEN },
    live:      { bg: '#DCFCE7', color: GREEN },
    draft:     { bg: '#F3F4F6', color: MUTED },
    archived:  { bg: '#EDE9FE', color: PURPLE },
  };
  const cfg = map[status] || map.draft;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
      background: cfg.bg, color: cfg.color,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.color, display: 'inline-block' }} />
      {status}
    </span>
  );
}

function CourseAccordion({ courseId, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet(`/api/admin/courses/${courseId}`)
      .then(res => setDetail(res))
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [courseId]);

  if (loading) return (
    <div style={{ padding: '16px 20px', background: LIGHT, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[1,2,3].map(i => <Skeleton key={i} height={36} />)}
    </div>
  );

  const modules = detail?.modules || detail?.sections || [];

  return (
    <div style={{ padding: '16px 20px', background: LIGHT, borderTop: `1px solid ${BORDER}` }}>
      {modules.length === 0 ? (
        <p style={{ fontSize: 13, color: MUTED, fontFamily: FONT, margin: 0 }}>No modules found for this course.</p>
      ) : modules.map((mod, mi) => (
        <div key={mod.id || mi} style={{ marginBottom: 12 }}>
          <div style={{
            fontSize: 12, fontWeight: 700, color: INK, fontFamily: FONT,
            marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>
            {mi + 1}. {mod.title || mod.name || `Module ${mi + 1}`}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 12 }}>
            {(mod.lessons || mod.items || []).map((lesson, li) => (
              <div key={lesson.id || li} style={{
                fontSize: 13, color: MUTED, fontFamily: FONT,
                padding: '6px 10px', background: WHITE, borderRadius: 8,
                border: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', background: `${AMBER}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: AMBER, flexShrink: 0 }}>
                  {li + 1}
                </span>
                {lesson.title || lesson.name || `Lesson ${li + 1}`}
                {lesson.duration_seconds && (
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: MUTED2 }}>
                    {Math.round(lesson.duration_seconds / 60)}m
                  </span>
                )}
              </div>
            ))}
            {(mod.lessons || mod.items || []).length === 0 && (
              <div style={{ fontSize: 12, color: MUTED2, fontFamily: FONT, padding: '4px 0' }}>No lessons</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

const STATUS_FILTERS = ['all', 'published', 'draft', 'archived'];


export { StatusPill, CourseAccordion, STATUS_FILTERS };
