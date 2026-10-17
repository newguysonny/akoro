#!/usr/bin/env bash
# Run one Verification Gate suite (or scenario) and fail unless PASS.
#   GATE_URL GATE_KEY  SUITE | SCENARIO  EXPECT_SHA (optional)  TARGET (default|production)
set -euo pipefail
if [ -z "${GATE_URL:-}" ] || [ -z "${GATE_KEY:-}" ]; then echo "::error::Set the AKORO_GATE_URL and AKORO_GATE_KEY secrets."; exit 1; fi
body=$(jq -nc --arg s "${SUITE:-}" --arg c "${SCENARIO:-}" --arg e "${EXPECT_SHA:-}" --arg t "${TARGET:-default}" \
  '{wait:false, actor:"github-actions"}
   + (if $c != "" then {scenario:$c} else {suite:$s} end)
   + (if $e != "" then {expectSha:$e} else {} end)
   + (if $t == "production" then {target:"production"} else {} end)')
start=$(curl -sS --fail-with-body -X POST "$GATE_URL/api/verify/runs" -H "Authorization: Bearer $GATE_KEY" -H 'Content-Type: application/json' -d "$body")
id=$(echo "$start" | jq -r '.data.id')
[ -n "$id" ] && [ "$id" != null ] || { echo "::error::The gate did not start a run: $start"; exit 1; }
echo "Run $id ($(echo "$start" | jq -r '.data.target // "?"'))"
run=""
for i in $(seq 1 90); do
  run=$(curl -sS "$GATE_URL/api/verify/runs/$id" -H "Authorization: Bearer $GATE_KEY")
  [ "$(echo "$run" | jq -r .data.status)" = "done" ] && break
  sleep 10
done
echo "$run" | jq '.data | {verdict, reason, sha, target, scenarios: [.scenarios[]? | {name, verdict, failed: [.failed[]? | {name, expected, actual}]}]}'
verdict=$(echo "$run" | jq -r .data.verdict)
{
  echo "### Backend gate — ${SCENARIO:-$SUITE}: $verdict"
  echo "Run \`$id\` on $(echo "$run" | jq -r '.data.target') at \`$(echo "$run" | jq -r '.data.sha')\`"
  echo
  echo "$run" | jq -r '.data.scenarios[]? | "- \(.verdict) `\(.name)`" + ([.failed[]? | "\n  - ✗ \(.name): expected \(.expected|tostring), got \(.actual|tostring)"] | join(""))'
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
[ "$verdict" = "PASS" ] || { echo "::error::Backend gate verdict $verdict"; exit 1; }
