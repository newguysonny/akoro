# blogs

Learner blog posts: listing, creating and updating a learner's own posts, plus
the mirror that keeps published posts in the content store.

## Entry

`index.js` is the cross-module entry point. It re-exports the service functions
the chat tools call (`listMyBlogs`, `createBlogPost`, `updateBlogPost`); the
Express router is mounted directly from `routes.js` by `app.js`.

## Extend

Add pure validation/formatting to `service.js` so tests can exercise it without
a database. Mirror writes belong in `mirror.js`.

## Limits

Publishing mirrors content asynchronously; a mirror failure does not roll back
the post.
