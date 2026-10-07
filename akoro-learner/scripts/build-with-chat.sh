#!/usr/bin/env bash
#
# Vercel build for the learner deployment, which also serves the standalone
# AI chat under /ai-chat on the school custom domains it hosts.
#
# It builds the learner SPA, then builds the dedicated chat app (base
# '/ai-chat/') from the sibling akoro-school package and drops its output
# into dist/ai-chat so /ai-chat/* resolves on the same origin. Paired with
# the /ai-chat rewrite in vercel.json.
#
# Run from the akoro-learner project root (Vercel Root Directory).
set -euo pipefail

echo "→ Building learner SPA"
npm run build

echo "→ Building standalone AI chat (../akoro-school)"
(
  cd ../akoro-school
  npm ci
  npm run build:chat
)

echo "→ Copying chat build into dist/ai-chat"
rm -rf dist/ai-chat
cp -r ../akoro-school/dist-chat dist/ai-chat

echo "✓ Learner + AI chat build complete"
