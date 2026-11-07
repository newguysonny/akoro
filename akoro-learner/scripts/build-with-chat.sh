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

# VITE_TARGET (set per Vercel project): "landing" = akoro.name.ng, "app" = app.akoro.name.ng. Either of those is a
# plain SPA build: the school custom-domain hosting and the standalone AI chat (below) stay with the unsplit
# ("full") deployment until the school deployment takes them over.
case "${VITE_TARGET:-full}" in
  landing|app)
    echo "→ Building the ${VITE_TARGET} site (no AI chat bundle)"
    npm run build
    echo "✓ ${VITE_TARGET} build complete"
    exit 0
    ;;
esac

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
