---
title: Communities overview
status: beta
doc_status: overview
tier: 2
audience: [learner, developer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
capabilities: []
---

# Communities overview

Higher-ed study groups with discovery, membership, creator-authored activities,
shared items and group discussion.

## What it covers

Communities are separate from courses. A community has one creator/owner and any
number of members. Members discover and join communities, complete
creator-authored activities, share items and chat in a per-community
discussion.

## Primary flow

1. A learner discovers and joins a community.
2. The creator authors activities; members submit work.
3. Members share items and view creator analytics.
4. The per-community discussion runs as a group chat beside connected content.

## Status

Implemented and in use; treat as **beta** for public documentation.

## Permissions

- Whole router is authenticated.
- Only the creator edits, deletes, creates activities and reads analytics.
- Join and submission are idempotent.

## Data

Communities, memberships, activities, submissions, items and discussion
messages.

## Documentation gaps

- Member/analytics view detail.

## Related

- Public docs: `akoro-docs/content/docs/learn/communities.mdx`
- Module: `akoro-api/modules/communities/README.md`
