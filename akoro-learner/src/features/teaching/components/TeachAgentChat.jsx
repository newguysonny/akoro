// The live session chat — SessionChatView with everything the session owns.
import SessionChatView from './SessionChatView.jsx';
import TeachAgentMaterialBox from './TeachAgentMaterialBox.jsx';

export default function TeachAgentChat({ reader, embedded }) {
  const {
    blocks, loading, initLoading, prepNote, input, setInput, handleSend, quote, setQuote,
    topic, subject, config, agentNm, agentEm, mode, userTurns, summary, generateSummary,
    handleMinimize, recording, toggleRecording, seconds, voiceStreaming, interimText,
    voiceLevel, toggleVoiceStream, cogState, guide, wsReady, openSwitch, switching,
    connState, onClose, readerOpen, closeReader, openReader, content, jumpToCitation,
    setBoardOpen, liveStudent, liveGuide,
  } = reader;

  return (
    <SessionChatView
      blocks={blocks}
      loading={loading || (initLoading && blocks.length === 0)}
      loadingNote={initLoading && blocks.length === 0 ? prepNote : ''}
      input={input}
      onInputChange={setInput}
      onSend={handleSend}
      quote={quote}
      onQuoteClear={() => setQuote(null)}
      topic={topic}
      subject={subject}
      reference={config?.reference || null}
      agentName={agentNm}
      agentEmoji={agentEm}
      mode={mode}
      userTurns={userTurns}
      showSummarize={userTurns >= 2 && !summary}
      onSummarize={generateSummary}
      onMinimize={handleMinimize}
      recording={recording}
      onToggleRecording={toggleRecording}
      seconds={seconds}
      voiceStreaming={voiceStreaming}
      interimText={interimText}
      voiceLevel={voiceLevel}
      onToggleVoice={toggleVoiceStream}
      cognitive={cogState}
      guideLabel={`${guide.emoji} ${guide.name}`}
      onSwitchAgent={wsReady ? openSwitch : null}
      switching={switching}
      connState={connState}
      onClose={onClose}
      embedded={embedded}
      onOpenReader={readerOpen ? closeReader : openReader}
      onCite={content ? jumpToCitation : null}
      onOpenBoard={() => setBoardOpen(true)}
      materialBox={<TeachAgentMaterialBox reader={reader}/>}
      liveStudent={liveStudent}
      liveGuide={liveGuide}
    />
  );
}
