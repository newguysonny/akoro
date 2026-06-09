import { useState, useEffect } from 'react';
import { apiGet } from '../services/api.js';

const NANA_RS = {
  bubbleBg:'rgba(124,58,237,0.10)', bubbleBorder:'#7C3AED',
  labelColor:'#7C3AED', ttsVoice:'alloy', assessStyle:'gentle',
};

export function useAgentProfile() {
  const [agentProfile, setAgentProfile] = useState({
    name:            '',
    emoji:           '🤖',
    teacherAgentId:  'nana-sargeant',
    guideName:       'NaNa Esumai',
    guideEmoji:      '🧠',
    guideRenderStyle:NANA_RS,
    ttsVoice:        'alloy',
  });

  useEffect(() => {
    apiGet('/api/user/agent').then(d => {
      if (d.agent_name) setAgentProfile({
        name:            d.agent_name,
        emoji:           d.agent_emoji   || '🤖',
        teacherAgentId:  d.teacher_agent_id || 'nana-sargeant',
        guideName:       d.guide_name    || 'NaNa Esumai',
        guideEmoji:      d.guide_emoji   || '🧠',
        guideRenderStyle:d.guide_render_style || NANA_RS,
        ttsVoice:        d.tts_voice     || 'alloy',
      });
    }).catch(() => {});
  }, []);

  return [agentProfile, setAgentProfile];
}
