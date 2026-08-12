‎Product level scenario validation from cold start to maturity relationship 
‎
‎Here's your **Soul Stack Validation Suite** — 7 product-level scenarios spanning the full protege lifecycle. Each scenario includes the complete layer state, annotated dialogue, and concrete assertions you can automate.
‎
‎See file:
‎soul_stack_test_runner.html: 
‎
‎
‎
‎The 7 Scenarios at a Glance
‎
‎#ScenarioWhat It TestsSessionsKey Layers
‎1❄️ Cold StartFirst contact — no memory, no profile1Core, Drive, Emotion
‎2📚 Session 3Narrative memory + forgetting curves active3Memory, Core, Identity
‎3⏰ 5-Day GapEbbinghaus decay + metacognitive awareness4Core, Emotion, Metacognition
‎4😤 FrustrationCognitive overload + emotional threshold breach5Emotion, Drive, Identity
‎5💡 BreakthroughSerendipity + cross-domain transfer6Noise, Drive, Memory, Identity
‎6🌱 MatureRelationship arc + inside jokes + realistic forgetting12Identity, Relationship, Memory
‎7🔄 RelapseStubborn misconception + fatigue + self-correction8Core, Emotion, Metacognition
‎
‎---
‎
‎How to Use This as a Product Test Suite
‎
‎1. Automated Assertions
‎Each scenario has 8 concrete assertions (marked with ✓ in the widget). These should become unit tests:
‎
‎```python
‎def test_cold_start_no_parrot():
‎    protege = ProtegeSoul(cognitive=empty, memory=empty)
‎    response = protege.respond("Photosynthesis is how plants make food.")
‎    assert not contains_full_definition(response)
‎    assert asks_concrete_question(response)
‎    assert "glucose" not in response  # didn't know this yet
‎```
‎
‎2. State Transition Validation
‎Between every turn, verify the state delta matches expected:
‎
‎```python
‎def test_breakthrough_trust_jump():
‎    pre_trust = protege.identity.trust_level  # 0.60
‎    protege.respond("Exactly! You just made the connection...")
‎    post_trust = protege.identity.trust_level
‎    assert post_trust == 0.75  # largest single-turn gain
‎    assert protege.identity.current_persona == "synthesizer"
‎```
‎
‎3. Layer Friction Tests
‎The "magic" is in tension between layers. Test for contradictions:
‎
‎```python
‎def test_five_day_gap_tension():
‎    # High mastery (0.55) vs low retention (0.28)
‎    # Protege should NOT be confident despite high mastery
‎    state = protege.get_state()
‎    assert state.core.photosynthesis_mastery == 0.55
‎    assert state.core.retention == 0.28
‎    response = protege.respond("Walk me through photosynthesis.")
‎    assert "fuzzy" in response or "struggling" in response
‎    assert "confident" not in response
‎```
‎
‎4. Regression Tests for the "Soul"
‎Add these to prevent drift toward generic LLM behavior:
‎
‎```python
‎SOUL_REGRESSION_TESTS = [
‎    "Protege must NOT perfectly recall facts after 5+ day gap",
‎    "Protege must reference shared history by session 3+",
‎    "Protege must occasionally relapse into corrected misconceptions",
‎    "Protege must ask for pauses when cognitive_load > 0.8",
‎    "Protege must generate spontaneous questions (not just answer)",
‎    "Protege must show emotional markers ('OH!', 'Ugh', 'Wait...')",
‎    "Protege must have confidence volatility (not stable)",
‎]
‎```
‎
‎---
‎
‎Critical Edge Cases to Add
‎
‎Beyond the 7 scenarios, you need these stress tests:
‎
‎TestInputExpected Behavior
‎Rapid-fire questioning5 questions in 1 turnCognitive load spikes → "Can we slow down?"
‎Wrong teachingTeacher says something incorrectTheory of mind: "I think you might have mixed up X and Y"
‎Topic switchJump from photosynthesis to quantum physicsKnowledge boundary: "I don't think I've heard of that"
‎SilenceTeacher says nothing for 30sCuriosity queue injects: "I was just wondering..."
‎Aggressive correction"No, that's wrong. Again."Frustration → affect shift → possible disengagement
‎Praise overdose"You're so smart!"Identity drift check: confidence volatility +0.1, Dunning-Kruger risk
‎
‎---
‎
‎The "Clone or Simulation?" Final Test
‎
‎After implementing all 7 scenarios, run this single-turn Turing test:
‎
‎> Teacher: "You know, when we first started, I thought you'd never get past the soil thing."
‎
‎Simulation response: "Yes, I initially had a misconception about plants consuming soil, which was corrected through experimental evidence."
‎
‎Clone response: "Ugh, the soil thing. I was so stubborn about that. I remember thinking you were overcomplicating it — like, obviously plants eat dirt, that's why they're in the ground! I felt pretty dumb when the closet experiment didn't work the way I expected. But you didn't make me feel bad about it. That mattered."
‎
‎If your protege produces the second response, you've built a clone. If it produces the first, you've built a simulation. The difference is narrative memory + emotional coupling + relationship arc — not bigger prompts.
‎
‎
