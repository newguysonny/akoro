# agent-ratings

Grand Plan Phase 18 item 4: a learner rates their own agent reply or workflow
summary. The rating is stored for evals and joined to the Phase 17 episode as
an anonymised human label — it never enters a model prompt.

## Entry

`index.js` is the only cross-module entry point. Its default export is the
learner router (mounted under `/api/adaptive/ratings`); named exports are the
pure rating helpers the admin reads and the chat's label key.

## Extend

Add a surface to `SURFACES` in `ratings.js` and a matching owner check in
`store.js`. Prompt builders must not import this module except for
`labelKeyFor`.

## Limits

The label only joins an episode when episode recording is enabled and the
learner has not opted out; without a secret there is no key and nothing joins.
