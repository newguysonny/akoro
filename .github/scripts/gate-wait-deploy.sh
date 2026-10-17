#!/usr/bin/env bash
# Wait until the deployed API (and, when gate runs go there, its sandbox)
# reports commit $SHA. Writes deployed=true|false to $GITHUB_OUTPUT.
#   GATE_URL  e.g. https://api.akoro.name.ng      GATE_KEY  the gate key
#   SHA       the commit to wait for               WAIT_MIN  minutes (default 25)
set -uo pipefail
if [ -z "${GATE_URL:-}" ] || [ -z "${GATE_KEY:-}" ]; then
  echo "::warning::The AKORO_GATE_URL / AKORO_GATE_KEY secrets are not set — the gates can't run. See .github/workflows/verification-gates.yml."
  echo "deployed=false" >> "$GITHUB_OUTPUT"; exit 0
fi
deadline=$(( $(date +%s) + ${WAIT_MIN:-25} * 60 ))
api=""; sandbox=""; goes=""
while [ "$(date +%s)" -lt "$deadline" ]; do
  api=$(curl -s -m 15 "$GATE_URL/health" | jq -r '.build.git // empty' 2>/dev/null)
  if [ "$api" = "$SHA" ]; then
    info=$(curl -s -m 30 "$GATE_URL/api/verify/scenarios" -H "Authorization: Bearer $GATE_KEY")
    goes=$(echo "$info" | jq -r '.data.runsGoTo // "here"')
    sandbox=$(echo "$info" | jq -r '.data.sandbox.sha // empty')
    if [ "$goes" != "sandbox" ] || [ "$sandbox" = "$SHA" ]; then
      echo "Deployed: API $api${sandbox:+, sandbox $sandbox}"
      echo "deployed=true" >> "$GITHUB_OUTPUT"
      exit 0
    fi
  fi
  echo "waiting… API ${api:-?}${goes:+, runs go to $goes}${sandbox:+ (sandbox ${sandbox})}"
  sleep 20
done
echo "::notice::Commit $SHA was not deployed within ${WAIT_MIN:-25} min (API ${api:-?}, sandbox ${sandbox:-n/a}) — the gates did not run against it."
echo "deployed=false" >> "$GITHUB_OUTPUT"
