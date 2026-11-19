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

## Extend

Add a helper file under this module and re-export its public names from
`index.js`. New routes go in `routes.js` (mounted by `router.js`) or a sibling
router file that `router.js` mounts.

## Limits

`routes.js` and `mgmt.js` are the module's large files; new behaviour belongs in
a smaller sibling. Template hosting needs Supabase Storage (`school-sites`
bucket); the default document/website templates are code-resident JSON/JS, not
per-school rows.
