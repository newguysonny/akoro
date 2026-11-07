#!/usr/bin/env bash
#
# Vercel build for the school deployment: the portal SPA plus the standalone AI chat, which is served under /ai-chat
# on every school's own host (<slug>.akoro.name.ng and verified custom domains). Paired with the /ai-chat rewrite in
# vercel.json. Run from the akoro-school project root (Vercel Root Directory).
set -euo pipefail

echo "→ Building the school portal"
npm run build

echo "→ Building the standalone AI chat"
npm run build:chat

echo "→ Copying the chat build into dist/ai-chat"
rm -rf dist/ai-chat
cp -r dist-chat dist/ai-chat

echo "✓ School portal + AI chat build complete"
