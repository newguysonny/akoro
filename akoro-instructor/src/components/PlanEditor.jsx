/**
 * PlanEditor — the subtopic + objective editor shared by AI Self Study and the
 * Activities page. The AI drafts; the teacher decides: every line is editable
 * and removable, because an objective the teacher didn't agree with is worse
 * than no objective at all.
 */
import {
  Plus, Sparkles, X,
} from 'lucide-react';
import { Btn } from './Primitives.jsx';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, PURPLE, FONT } from '../constants.js';

/* ── Subtopic + objective editor ─────────────────────────────────────────
   The AI drafts; the teacher decides. Every line here is editable and
   removable, because an objective the teacher didn't agree with is worse than
   no objective at all. */
function PlanEditor({ subtopics, objectives, onChange }) {
  const setSubtopic = (i, value) => {
    const old = subtopics[i];
    const next = [...subtopics]; next[i] = value;
    const objs = { ...objectives };
    if (old !== value) { objs[value] = objs[old] ?? []; delete objs[old]; }
    onChange(next, objs);
  };
  const removeSubtopic = (i) => {
    const old = subtopics[i];
    const objs = { ...objectives }; delete objs[old];
    onChange(subtopics.filter((_, j) => j !== i), objs);
  };
  const addSubtopic = () => onChange([...subtopics, ''], { ...objectives, '': [] });
  const setObjective = (st, j, value) => {
    const list = [...(objectives[st] ?? [])]; list[j] = value;
    onChange(subtopics, { ...objectives, [st]: list });
  };
  const addObjective = (st) => onChange(subtopics, { ...objectives, [st]: [...(objectives[st] ?? []), ''] });
  const removeObjective = (st, j) =>
    onChange(subtopics, { ...objectives, [st]: (objectives[st] ?? []).filter((_, k) => k !== j) });

  if (!subtopics.length) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', border: `1px dashed ${BORDER}`, borderRadius: 12, background: LIGHT }}>
        <Sparkles size={20} color={MUTED} style={{ marginBottom: 6 }} />
        <div style={{ fontSize: 12, color: MUTED, fontFamily: FONT }}>
          Enter a subject and topic, then draft the plan — or add subtopics yourself.
        </div>
        <Btn size="sm" variant="secondary" style={{ marginTop: 10 }} onClick={addSubtopic}>
          <Plus size={13} /> Add a subtopic
        </Btn>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {subtopics.map((st, i) => (
        <div key={i} style={{ border: `1px solid ${BORDER}`, borderRadius: 12, padding: '10px 12px', background: WHITE }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{
              width: 20, height: 20, borderRadius: 6, flexShrink: 0, background: `${PURPLE}18`,
              color: PURPLE, fontSize: 11, fontWeight: 900, textAlign: 'center', lineHeight: '20px',
            }}>{i + 1}</span>
            <input
              value={st} onChange={e => setSubtopic(i, e.target.value)}
              placeholder="Subtopic"
              style={{
                flex: 1, border: 'none', outline: 'none', background: 'transparent',
                fontSize: 13, fontWeight: 700, color: INK, fontFamily: FONT,
              }}
            />
            <button type="button" onClick={() => removeSubtopic(i)} title="Remove subtopic"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED, display: 'flex', padding: 2 }}>
              <X size={14} />
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, paddingLeft: 28 }}>
            {(objectives[st] ?? []).map((obj, j) => (
              <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 4, height: 4, borderRadius: '50%', background: MUTED2, flexShrink: 0 }} />
                <input
                  value={obj} onChange={e => setObjective(st, j, e.target.value)}
                  placeholder="Learning objective"
                  style={{
                    flex: 1, border: 'none', outline: 'none', background: 'transparent',
                    fontSize: 12, color: MUTED, fontFamily: FONT,
                  }}
                />
                <button type="button" onClick={() => removeObjective(st, j)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED2, display: 'flex', padding: 2 }}>
                  <X size={12} />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => addObjective(st)}
              style={{
                alignSelf: 'flex-start', background: 'none', border: 'none', cursor: 'pointer',
                color: AMBER, fontSize: 11, fontWeight: 700, fontFamily: FONT, padding: '2px 0',
              }}>
              + objective
            </button>
          </div>
        </div>
      ))}
      <Btn size="sm" variant="secondary" type="button" onClick={addSubtopic} style={{ alignSelf: 'flex-start' }}>
        <Plus size={13} /> Add a subtopic
      </Btn>
    </div>
  );
}

export default PlanEditor;
