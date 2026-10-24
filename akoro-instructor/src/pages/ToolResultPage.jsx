/**
 * ToolResultPage — one saved teaching-tool result, on a page of its own
 * (/library/:id) at the full content width, the way an activity opens.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageLayout } from '../components/Layout.jsx';
import { Btn } from '../components/Primitives.jsx';
import { Ico } from '../theme/Ico.jsx';
import { C } from '../theme/colors.js';
import { apiGet } from '../services/api.js';
import { ToolRunner } from '../components/teaching/TeachingTools.jsx';
import { TOOL_NAME, TOOL_EMOJI } from '../components/teaching/ToolResult.jsx';

const OUTPUT_OF = { 'podcast': 'script', 'vocabulary': 'cards', 'essay-grader': 'grades' };
// Saved payloads predate the `output` field, so infer it from what is inside.
function guessOutput(c, kind) {
  if (!c) return 'markdown';
  if (Array.isArray(c.entries)) return OUTPUT_OF[kind] || 'doc';
  if (Array.isArray(c.turns)) return 'script';
  if (Array.isArray(c.grades)) return 'grades';
  if (Array.isArray(c.cards) && c.cards[0]?.blocks) return 'doc';
  if (Array.isArray(c.cards)) return 'cards';
  return 'markdown';
}

export default function ToolResultPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [row, setRow] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setRow(null); setError('');
    apiGet(`/api/instructor/tools/outputs/${id}`)
      .then((res) => setRow(res.output))
      .catch(() => setError('We could not find that result.'));
  }, [id]);

  const back = () => navigate('/library');
  const tool = row && { key: row.kind, name: TOOL_NAME[row.kind], emoji: TOOL_EMOJI[row.kind], output: row.content?.output || guessOutput(row.content, row.kind) };

  return (
    <PageLayout
      title={TOOL_NAME[row?.kind] || 'Library'}
      subtitle="Saved in your Library"
      action={<Btn size="sm" variant="ghost" onClick={back}><Ico ti="ti-arrow-left" size={14} /> Library</Btn>}
    >
      {error ? (
        <div style={{ color: C.muted, fontSize: 14 }}>
          <p>{error}</p>
          <Btn onClick={back}>Back to Library</Btn>
        </div>
      ) : !row ? (
        <div style={{ height: 160, borderRadius: 16, background: C.tagBg, animation: 'pulse-dot 1.5s ease-in-out infinite' }} />
      ) : row.content ? (
        <ToolRunner.Result tool={tool} out={row.content} title={row.title} bare />
      ) : (
        <p style={{ color: C.muted, fontSize: 14 }}>This result has no content.</p>
      )}
    </PageLayout>
  );
}
