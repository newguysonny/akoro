// Library feature — public surface.
//
// The learner's shelf: the page, its folders and the record teach session.
// Features only see this file; shared code lives in
// src/{components,contexts,hooks,lib,services,utils,client}.
export { default } from './LibraryPage.jsx';
export { default as LibraryPage } from './LibraryPage.jsx';
export { default as LibraryFolderPage } from './components/LibraryFolderPage.jsx';
export { default as FolderReaderSession } from './components/FolderReaderSession.jsx';
export { default as RecentlyDeletedPage } from './components/RecentlyDeletedPage.jsx';
export { default as RecordTeachSession, recordFileType } from './components/RecordTeachSession.jsx';
