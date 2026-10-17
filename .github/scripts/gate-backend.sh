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
# Optional: EDGE_HEADER="Name: value" — what a Cloudflare skip rule in front of the API lets through.
# Trimmed: a secret pasted with a trailing newline would end the request's
# headers early (the edge lets it through, the API gets a broken request: 502).
trim() { printf '%s' "$1" | tr -d '\r\n' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//'; }
EDGE_HEADER=$(trim "${EDGE_HEADER:-}")
GATE_KEY=$(trim "${GATE_KEY:-}")
GATE_URL=$(trim "${GATE_URL:-}"); GATE_URL=${GATE_URL%/}
edge=(); [ -n "$EDGE_HEADER" ] && edge=(-H "$EDGE_HEADER")
hdrs=$(mktemp)
# A 502/503/504 is the API restarting (a deploy) or waking: try again a few times.
for attempt in 1 2 3 4 5 6; do
  start=$(curl -sS -D "$hdrs" -X POST "$GATE_URL/api/verify/runs" "${edge[@]}" -H "Authorization: Bearer $GATE_KEY" -H 'Content-Type: application/json' -d "$body")
  code=$(awk 'toupper($1) ~ /^HTTP/ {c=$2} END {print c}' "$hdrs")
  case "$code" in 502|503|504) echo "The API answered $code (restarting?) — retrying in 20s ($attempt/6)"; sleep 20 ;; *) break ;; esac
done
if [ "${code:-0}" -ge 400 ]; then
  # Which part is refused? Status of a few variants of the same request.
  probe() { printf '  %-44s %s\n' "$1" "$(curl -s -o /dev/null -m 30 -w '%{http_code}' "${@:2}")"; }
  echo "Probes:"
  probe "GET /health" "$GATE_URL/health"
  probe "GET /health + edge header" "${edge[@]}" "$GATE_URL/health"
  probe "GET /api/verify/suites + edge (no key)" "${edge[@]}" "$GATE_URL/api/verify/suites"
  probe "GET /api/verify/suites + edge + key" "${edge[@]}" -H "Authorization: Bearer $GATE_KEY" "$GATE_URL/api/verify/suites"
  probe "GET /api/verify/suites + edge + x-agent-console-key" "${edge[@]}" -H "x-agent-console-key: $GATE_KEY" "$GATE_URL/api/verify/suites"
  echo "  (key length ${#GATE_KEY}, edge header length ${#EDGE_HEADER})"
  echo "::error::The gate answered $code."
  grep -iE '^(server|cf-ray|cf-mitigated|x-render-origin-server):' "$hdrs" || true
  echo "$start" | grep -o '<title>[^<]*</title>' || echo "$start" | head -c 300
  if [ "$code" = "403" ] && grep -qi '^server: cloudflare' "$hdrs" && ! grep -qi '^x-render-origin-server' "$hdrs"; then
    echo "::error::Cloudflare refused the request before it reached the API (GitHub's runners are datacenter IPs). Add a Cloudflare skip rule for the AKORO_EDGE_HEADER secret — see .github/workflows/verification-gates.yml."
  fi
  exit 1
fi
id=$(echo "$start" | jq -r '.data.id')
[ -n "$id" ] && [ "$id" != null ] || { echo "::error::The gate did not start a run: $start"; exit 1; }
echo "Run $id ($(echo "$start" | jq -r '.data.target // "?"'))"
run=""
for i in $(seq 1 90); do
  run=$(curl -sS "$GATE_URL/api/verify/runs/$id" "${edge[@]}" -H "Authorization: Bearer $GATE_KEY")
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
