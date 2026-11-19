/**
 * curriculum — curriculum documents, their grounding retrieval and the
 * publish/import path.
 *
 * Pure re-export entry: importing it must not mount routes or start work.
 */
export { getCurriculumGrounding } from "./routes.js";
export { publishCurriculumDoc } from "./importDoc.js";
