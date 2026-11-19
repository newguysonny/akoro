# agent-tool-requests

Learner-approved requests for a new tool, component, or bug fix, and the admin
review queue's shared rules. Learners file requests through Agent Chat only;
there is no learner-facing endpoint.

## Entry

`index.js` is the only cross-module entry point. `service.js` files and reviews
requests; `validation.js` holds the category/kind/status sets and the request
normalisers used by the admin queue.

## Extend

Add a field to `validation.js` first, then thread it through `service.js`.
Admin status changes must stay review-only: no provisioning or third-party
call belongs here.

## Limits

The admin router (`modules/admin/agent-tool-requests.js`) owns the queue UI
contract, not this module. Requests never carry a chat transcript.
