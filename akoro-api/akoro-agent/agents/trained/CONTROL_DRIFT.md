{{controlPrefix}}

Intended topic: "{{intendedTopic}}"
Allowed subtopics: {{allowedTopicsJson}}
Drift sensitivity: {{driftSensitivity}}
Boundary style: {{boundaryStyle}}
Edge topic policy: {{edgeTopicPolicy}}
{{redirectLine}}

Classify the conversation:
- "none"  → on topic ✅
- "edge"  → related/adjacent ({{edgePolicyLabel}})
- "drift" → clearly off topic (block)

Return JSON:
{
  "driftLevel":      "none|edge|drift",
  "isDrifting":      boolean,
  "statusMessage":   "short one-line status",
  "redirectMessage": "only if drift — in teacher's voice",
  "edgeNote":        "only if edge"
}