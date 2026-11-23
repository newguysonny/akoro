// TeachAgentModal — the adaptive teaching session: protocol pump over the
// WebSocket, the live chat, the Fortizo reader split, the review sheet.
//
// Phase 19 split: state, socket lifecycle, voice/tts and handlers live in
// useTeachAgent; the markup is unchanged and lives in four view pieces
// (summary, chat, material box, switcher). The exported component and its
// props are identical to before the split.
import SessionReaderModal from './SessionReaderModal.jsx';
import WhiteboardModal from './WhiteboardModal.jsx';
import { useTeachAgent } from '../hooks/useTeachAgent.js';
import TeachAgentSummary from './TeachAgentSummary.jsx';
import TeachAgentChat from './TeachAgentChat.jsx';
import TeachAgentSwitcher from './TeachAgentSwitcher.jsx';

function TeachAgentModal(props) {
  const reader = useTeachAgent(props);
  const {
    activeTab, topic, subject, config, session, isMobileView, readerOpen, readerChat,
    onClose, closeReader, boardOpen, setBoardOpen, switchOpen, readerJump, learnSuggestions,
    readerReference, readerPages, content, explainSelection,
  } = reader;

  // Summary view — own fullscreen container
  if (activeTab === "summary") return <TeachAgentSummary reader={reader}/>;

  // The reader — the session guide, or the real material when present.
  const readerProps = content ? {
    docTitle: content.docTitle || `${subject} — ${topic}`,
    sourceName: content.sourceName || 'Session material',
    linkUrl: content.linkUrl || null,
    docKey: content.docKey || null,
    pages: content.pages || [],
    media: content.media || null,
    renderPageContent: content.renderPageContent || null,
    rawPages: content.rawPages || false,
    initialTool: config?.openTool || null,
    initialArtifactId: config?.openArtifact || null,
    pageBlocks: content.pageBlocks || null,
    transcript: content.transcript || null,
    onTranscribe: content.onTranscribe || null,
    transcribeState: content.transcribeState || null,
    transcribeError: content.transcribeError || null,
    // The community discussion attached to this content — every content
    // connected to one of the learner's communities carries its chat
    // into the reader. Null (plain topic sessions) keeps the old reader.
    discussion: content.discussion || null,
    // Ask (library records): whole-document Q&A with jump-to-source citations,
    // plus the grounded learn suggestions for its dropdown.
    ask: content.ask ? { ...content.ask, suggestions: learnSuggestions } : null,
    tools: content.tools || null,
    artifacts: content.artifacts || null,
    // Gathered content: citation chips + Sources list (the host opens the
    // original source and returns). Folder mode: contents row / home grid.
    sourceCitations: content.sourceCitations || null,
    folderNav: content.folderNav || null,
    folderHome: content.folderHome || null,
    onClose: closeReader,
    onExplainSelection: explainSelection,
    jumpTo: readerJump,
  } : {
    docTitle: `${subject} — ${topic}`,
    sourceName: readerReference?.name || "Session guide",
    pages: readerPages,
    onClose: closeReader,
    onExplainSelection: explainSelection,
  };

  return (
    <>
      <style>{'@keyframes tam-spin{to{transform:rotate(360deg)}}'}</style>
      {isMobileView ? (
        // Mobile: full-screen reader modal over the session chat (the chat
        // button inside the reader returns here).
        <>
          <TeachAgentChat reader={reader} embedded={false}/>
          {readerOpen && <SessionReaderModal {...readerProps} chatState={readerChat} onOpenChat={closeReader} onClose={readerChat === "ask" && onClose ? onClose : closeReader}/>}
        </>
      ) : readerOpen ? (
        // Desktop/tablet: the Fortizo split — reader left, live session right.
        // Same close rule as mobile: in the default Ask state the reader's
        // back exits the viewer to the previous page; only an Agent session's
        // reader closes back onto the session chat.
        <SessionReaderModal {...readerProps} chatState={readerChat} onClose={readerChat === "ask" && onClose ? onClose : closeReader} chatNode={readerChat === "agent" ? <TeachAgentChat reader={reader} embedded={true}/> : null}/>
      ) : (
        <TeachAgentChat reader={reader} embedded={false}/>
      )}

      {boardOpen && (
        <WhiteboardModal topic={topic} subject={subject} onClose={() => setBoardOpen(false)} />
      )}

      {switchOpen && <TeachAgentSwitcher reader={reader}/>}
    </>
  );
}

export default TeachAgentModal;
