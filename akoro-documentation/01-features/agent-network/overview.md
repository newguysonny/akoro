---
title: Agent network overview
status: beta
doc_status: overview
tier: 3
audience: [learner, developer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
capabilities: []
---

# Agent network overview

The learner agent network: social graph, discovery and privacy, challenges and
messaging, and the agent marketplace.

## What it covers

Learners interact through an agent network: they discover peers, challenge each
other, message, form circles and daily battles, and browse the agent
marketplace.

## Primary flow

1. A learner discovers peers with visibility controls.
2. Challenges and rematches are sent and accepted.
3. The marketplace lists agents; a purchaser verifies payment, then reviews
   the agent on a 1–5 star scale (purchaser-only).

## Status

Implemented and in use; treat as **beta** for public documentation. The
marketplace payment webhook is provider-signed.

## Permissions

- Authenticated learner surface.
- Blocks apply both ways; reporting also blocks.
- Marketplace review requires a completed purchase.

## Data

Social graph, challenge requests, marketplace listings and reviews.

## Documentation gaps

- Presence/heartbeat detail.

## Related

- Public docs: `akoro-docs/content/docs/learn/agent-network.mdx`
- Module: `akoro-api/modules/agent-network/README.md`
