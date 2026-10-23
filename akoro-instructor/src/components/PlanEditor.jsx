/**
 * PlanEditor — the subtopic + objective editor shared by AI Self Study and the
 * Activities page. The AI drafts; the teacher decides: every line is editable
 * and removable, because an objective the teacher didn't agree with is worse
 * than no objective at all.
 */
import { Btn } from './Primitives.jsx';
import { PURPLE } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';

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
      <div style={{ padding: '20px', textAlign: 'center', border: `1px dashed ${C.border}`, borderRadius: 12, background: C.bg }}>
        <Ico ti="ti-sparkles" size={20} color={C.muted} style={{ marginBottom: 6 }} />
        <div style={{ fontSize: 12, color: C.muted, fontFamily: C.font }}>
          Enter a subject and topic, then draft the plan — or add subtopics yourself.
        </div>
        <Btn size="sm" variant="secondary" style={{ marginTop: 10 }} onClick={addSubtopic}>
          <Ico ti="ti-plus" size={13} /> Add a subtopic
        </Btn>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {subtopics.map((st, i) => (
        <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: '10px 12px', background: C.surface }}>
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
                fontSize: 13, fontWeight: 700, color: C.ink, fontFamily: C.font,
              }}
            />
            <button type="button" onClick={() => removeSubtopic(i)} title="Remove subtopic"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, display: 'flex', padding: 2 }}>
              <Ico ti="ti-x" size={14} />
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, paddingLeft: 28 }}>
            {(objectives[st] ?? []).map((obj, j) => (
              <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 4, height: 4, borderRadius: '50%', background: C.muted2, flexShrink: 0 }} />
                <input
                  value={obj} onChange={e => setObjective(st, j, e.target.value)}
                  placeholder="Learning objective"
                  style={{
                    flex: 1, border: 'none', outline: 'none', background: 'transparent',
                    fontSize: 12, color: C.muted, fontFamily: C.font,
                  }}
                />
                <button type="button" onClick={() => removeObjective(st, j)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted2, display: 'flex', padding: 2 }}>
                  <Ico ti="ti-x" size={12} />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => addObjective(st)}
              style={{
                alignSelf: 'flex-start', background: 'none', border: 'none', cursor: 'pointer',
                color: C.brand, fontSize: 11, fontWeight: 700, fontFamily: C.font, padding: '2px 0',
              }}>
              + objective
            </button>
          </div>
        </div>
      ))}
      <Btn size="sm" variant="secondary" type="button" onClick={addSubtopic} style={{ alignSelf: 'flex-start' }}>
        <Ico ti="ti-plus" size={13} /> Add a subtopic
      </Btn>
    </div>
  );
}

export default PlanEditor;
