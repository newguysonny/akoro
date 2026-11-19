# curriculum

Curriculum documents: ingestion, embedding, grounding retrieval and publishing.

## Entry

`index.js` is the cross-module entry point. It re-exports
`getCurriculumGrounding` (the retrieval the chat tools use) and
`publishCurriculumDoc` (the import path). The Express router is mounted
directly from `routes.js` by `app.js`.

## Extend

Keep retrieval scoring and filters in `routes.js`'s exported helpers so callers
can test them without HTTP. Document parsing belongs in `importDoc.js`.

## Limits

Grounding needs an embedding provider; without one retrieval returns nothing.
