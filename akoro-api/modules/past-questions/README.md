# past-questions

Past-paper questions: ingestion, embedding and grounding retrieval.

## Entry

`index.js` is the cross-module entry point. It re-exports
`getPastQuestionGrounding`, the retrieval the chat tools use. The Express router
is mounted directly from `routes.js` by `app.js`.

## Extend

Keep retrieval scoring and filters in `routes.js`'s exported helpers so callers
can test them without HTTP.

## Limits

Grounding needs an embedding provider; without one retrieval returns nothing.
