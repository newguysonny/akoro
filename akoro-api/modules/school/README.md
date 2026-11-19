# school

The School partner portal plus the shared website-template and document-template
helpers used by admin, content, instructor, and vouchers.

## Entry

`index.js` is the only cross-module entry point. Its default export is the
`/api/school` router (`router.js`); the named exports are the template zip,
template storage, default website templates, document renderer, and default
document templates.

`index.js` is a pure re-export list: it never mounts a server, opens a
connection, or starts a job.

## Portal layers

`routes.js` is the thin `/api/school` router: path + middleware registration and
one-line handlers. Request orchestration (auth decisions, status codes,
transactions across tables) lives in the `service*.js` files, split by resource
(core, operations, domains, billing, content, site, website). Pure predicates,
normalisers and column maps live in `rules.js`. Every Supabase query lives in
`store.js` / `store-*.js`, grouped by table.

## Extend

Add a helper file under this module and re-export its public names from
`index.js`. New routes go in `routes.js` (mounted by `router.js`) or a sibling
router file that `router.js` mounts, with the work in the matching service and
the query in a store.

## Limits

`mgmt.js` is the module's remaining large file; new behaviour belongs in a
smaller sibling. Template hosting needs Supabase Storage (`school-sites`
bucket); the default document/website templates are code-resident JSON/JS, not
per-school rows.
