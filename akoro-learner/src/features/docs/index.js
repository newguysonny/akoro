// Docs feature — public surface.
//
// The Word-style document editor opened from an assignment's answer box: the
// ribbon, the page, the ruler and the status bar, plus the TipTap extensions
// and .docx writer wiring it uses. Features only see this file; shared code
// lives in src/{components,contexts,hooks,lib,services,utils,client}.
export { default as WordEditor } from './components/WordEditor.jsx';
