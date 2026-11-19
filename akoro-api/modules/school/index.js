/**
 * school — the only cross-module entry point. `default` is the /api/school
 * router; the named exports are the template/document helpers other modules
 * use. Nothing here starts a server or a background job.
 */
export { default } from "./router.js";
export { assembleMultiPageFromZip, ensureResponsiveViewport } from "./templateZip.js";
export { DEFAULT_TEMPLATES, getDefaultTemplate } from "./defaultTemplates/index.js";
export { ensureBucket, uploadPublicFile } from "./templateStorage.js";
export { renderDocument } from "./documentRenderer.js";
export { DEFAULT_DOC_TEMPLATES, getDefaultDoc } from "./defaultDocs/index.js";
