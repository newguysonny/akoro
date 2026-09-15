-- ============================================================================
-- 2026-concept-tracker-qualitative-v2.sql
-- Complete the deterministic qualitative lifecycle without storing learner chat
-- text. This replaces only the projection function introduced in v1.
-- ============================================================================
CREATE OR REPLACE FUNCTION edu.record_learner_concept_tracker(
  p_learner_id UUID, p_concept_id UUID, p_source_session_id TEXT, p_source_turn_id TEXT,
  p_observation_kind TEXT, p_claim_status TEXT
) RETURNS VOID LANGUAGE plpgsql SET search_path = edu, public AS $function$
DECLARE v_title TEXT; v_objective TEXT; v_curriculum TEXT; v_subject TEXT; v_topic TEXT;
  v_mastery NUMERIC; v_retention NUMERIC; v_evidence INTEGER; v_status TEXT; v_resume TEXT;
BEGIN
  SELECT c.title,c.objective,c.curriculum_key,c.subject,c.topic_key,s.mastery,s.retention,s.evidence_count
  INTO v_title,v_objective,v_curriculum,v_subject,v_topic,v_mastery,v_retention,v_evidence
  FROM edu.concept_catalog c LEFT JOIN edu.learner_concept_state s
    ON s.concept_id=c.id AND s.learner_id=p_learner_id
  WHERE c.id=p_concept_id AND c.status='approved';
  IF NOT FOUND OR p_claim_status='not_checked' THEN RETURN; END IF;

  -- The qualitative status is a readable projection of canonical, reviewed
  -- evidence. It does not replace mastery/retention and never accepts a model
  -- generated status. A contradictory supported check is deliberately a
  -- confusion signal, regardless of its numerical model confidence.
  v_status := CASE
    WHEN p_claim_status='contradicted' OR p_observation_kind='misconception_detected' THEN 'confused'
    WHEN COALESCE(v_mastery,0)>=.90 AND COALESCE(v_retention,0)>=.70 AND COALESCE(v_evidence,0)>=3 THEN 'mastered'
    WHEN COALESCE(v_mastery,0)>=.55 AND COALESCE(v_evidence,0)>=2
         AND p_observation_kind IN ('demonstrated_understanding','misconception_cleared','recall_success') THEN 'understood'
    WHEN COALESCE(v_evidence,0)>=2 THEN 'learning'
    ELSE 'introduced'
  END;
  v_resume := CASE v_status
    WHEN 'confused' THEN ('Return to '||v_title||': review the approved objective and try a new example.')
    WHEN 'introduced' THEN ('Continue from the introduction to '||v_title||' with one guided example.')
    WHEN 'learning' THEN ('Continue practising '||v_title||' with a short retrieval step.')
    WHEN 'understood' THEN ('Continue from '||v_title||' with application or retrieval practice.')
    WHEN 'mastered' THEN ('Continue to the next approved objective after '||v_title||'.')
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
    DELETE FROM edu.learner_concept_confusion_notes WHERE id IN (
      SELECT id FROM edu.learner_concept_confusion_notes WHERE learner_id=p_learner_id ORDER BY created_at DESC OFFSET 48
    );
  END IF;
END; $function$;

GRANT EXECUTE ON FUNCTION edu.record_learner_concept_tracker(UUID,UUID,TEXT,TEXT,TEXT,TEXT) TO service_role;
NOTIFY pgrst, 'reload schema';
