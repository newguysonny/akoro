-- Qualitative, curriculum-grounded tracker projection. No transcript content or
-- model rationale is stored here: notes/resume strings are assembled only from
-- reviewed catalogue objectives and deterministic policy outcomes.
CREATE SCHEMA IF NOT EXISTS edu;

CREATE TABLE IF NOT EXISTS edu.learner_concept_tracker (
  learner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  concept_id UUID NOT NULL REFERENCES edu.concept_catalog(id) ON DELETE CASCADE,
  learning_status TEXT NOT NULL DEFAULT 'not_started' CHECK (learning_status IN ('not_started','introduced','learning','confused','understood','mastered')),
  resume_point TEXT NOT NULL DEFAULT '' CHECK (char_length(resume_point) <= 420),
  last_observation_kind TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (learner_id, concept_id)
);
CREATE TABLE IF NOT EXISTS edu.learner_concept_confusion_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  concept_id UUID NOT NULL REFERENCES edu.concept_catalog(id) ON DELETE CASCADE,
  source_session_id TEXT NOT NULL CHECK (char_length(source_session_id) BETWEEN 1 AND 180),
  source_turn_id TEXT NOT NULL CHECK (char_length(source_turn_id) BETWEEN 1 AND 180),
  note TEXT NOT NULL CHECK (char_length(note) BETWEEN 3 AND 420),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (learner_id, concept_id, source_session_id, source_turn_id)
);
CREATE TABLE IF NOT EXISTS edu.learner_topic_resume_points (
  learner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  curriculum_key TEXT NOT NULL, subject TEXT NOT NULL, topic_key TEXT NOT NULL,
  resume_point TEXT NOT NULL CHECK (char_length(resume_point) BETWEEN 3 AND 420),
  concept_id UUID REFERENCES edu.concept_catalog(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (learner_id, curriculum_key, subject, topic_key)
);

CREATE OR REPLACE FUNCTION edu.record_learner_concept_tracker(
  p_learner_id UUID, p_concept_id UUID, p_source_session_id TEXT, p_source_turn_id TEXT,
  p_observation_kind TEXT, p_claim_status TEXT
) RETURNS VOID LANGUAGE plpgsql SET search_path = edu, public AS $function$
DECLARE v_title TEXT; v_objective TEXT; v_curriculum TEXT; v_subject TEXT; v_topic TEXT;
  v_mastery NUMERIC; v_retention NUMERIC; v_evidence INTEGER; v_status TEXT; v_resume TEXT;
BEGIN
  SELECT c.title,c.objective,c.curriculum_key,c.subject,c.topic_key,s.mastery,s.retention,s.evidence_count
  INTO v_title,v_objective,v_curriculum,v_subject,v_topic,v_mastery,v_retention,v_evidence
  FROM edu.concept_catalog c LEFT JOIN edu.learner_concept_state s ON s.concept_id=c.id AND s.learner_id=p_learner_id
  WHERE c.id=p_concept_id AND c.status='approved';
  IF NOT FOUND OR p_claim_status='not_checked' THEN RETURN; END IF;
  v_status := CASE
    WHEN p_claim_status='contradicted' OR p_observation_kind='misconception_detected' THEN 'confused'
    WHEN COALESCE(v_mastery,0)>=.90 AND COALESCE(v_retention,0)>=.70 AND COALESCE(v_evidence,0)>=3 THEN 'mastered'
    WHEN p_observation_kind IN ('demonstrated_understanding','misconception_cleared') THEN 'understood'
    ELSE 'learning' END;
  v_resume := CASE v_status
    WHEN 'confused' THEN ('Return to '||v_title||': review the approved objective and try a new example.')
    WHEN 'mastered' THEN ('Continue to the next approved objective after '||v_title||'.')
    WHEN 'understood' THEN ('Continue from '||v_title||' with application or retrieval practice.')
    ELSE ('Continue practising '||v_title||'.') END;
  INSERT INTO edu.learner_concept_tracker (learner_id,concept_id,learning_status,resume_point,last_observation_kind,updated_at)
  VALUES (p_learner_id,p_concept_id,v_status,v_resume,p_observation_kind,now())
  ON CONFLICT (learner_id,concept_id) DO UPDATE SET learning_status=EXCLUDED.learning_status,resume_point=EXCLUDED.resume_point,last_observation_kind=EXCLUDED.last_observation_kind,updated_at=EXCLUDED.updated_at;
  INSERT INTO edu.learner_topic_resume_points (learner_id,curriculum_key,subject,topic_key,resume_point,concept_id,updated_at)
  VALUES (p_learner_id,v_curriculum,v_subject,v_topic,v_resume,p_concept_id,now())
  ON CONFLICT (learner_id,curriculum_key,subject,topic_key) DO UPDATE SET resume_point=EXCLUDED.resume_point,concept_id=EXCLUDED.concept_id,updated_at=EXCLUDED.updated_at;
  IF v_status='confused' THEN
    INSERT INTO edu.learner_concept_confusion_notes (learner_id,concept_id,source_session_id,source_turn_id,note)
    VALUES (p_learner_id,p_concept_id,p_source_session_id,p_source_turn_id,('Review objective for '||v_title||': '||left(v_objective,300))) ON CONFLICT DO NOTHING;
    DELETE FROM edu.learner_concept_confusion_notes WHERE id IN (SELECT id FROM edu.learner_concept_confusion_notes WHERE learner_id=p_learner_id ORDER BY created_at DESC OFFSET 48);
  END IF;
END; $function$;

GRANT USAGE ON SCHEMA edu TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON edu.learner_concept_tracker,edu.learner_concept_confusion_notes,edu.learner_topic_resume_points TO service_role;
GRANT EXECUTE ON FUNCTION edu.record_learner_concept_tracker(UUID,UUID,TEXT,TEXT,TEXT,TEXT) TO service_role;
NOTIFY pgrst, 'reload schema';
