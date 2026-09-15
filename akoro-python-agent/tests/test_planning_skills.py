import unittest
from agent.adaptive.planning_skills import TopicSignal, calibrate_difficulty, knowledge_gap_analysis, prioritise_topics, session_sizing, synthesise_progress
class PlanningSkillTests(unittest.TestCase):
 def test_prioritises_reviewed_misconception_without_model_scores(self):
  weak=TopicSignal('Fractions',mastery=.8,retention=.8,evidence_confidence=.8,misconception_active=True,curriculum_weight=1)
  stale=TopicSignal('Decimals',mastery=.5,retention=.1,evidence_confidence=.5,curriculum_weight=.4)
  self.assertEqual(prioritise_topics([weak,stale])[0]['topic'],'Fractions')
  self.assertEqual(knowledge_gap_analysis([weak])[0]['reason'],'active_misconception')
 def test_difficulty_sizing_and_summary_are_bounded(self):
  mastered=TopicSignal('Algebra',mastery=.9,retention=.8,evidence_confidence=.8,learning_status='mastered')
  self.assertEqual(calibrate_difficulty(mastered),'hard')
  self.assertEqual(session_sizing(pacing='shorter_chunks',attention=.9,fatigue=.1),10)
  self.assertEqual(synthesise_progress([mastered])['mastered'],1)
if __name__=='__main__': unittest.main()
