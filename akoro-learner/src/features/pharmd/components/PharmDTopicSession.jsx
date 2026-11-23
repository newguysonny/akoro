/**
 * PharmDTopicSession.jsx — a PHARM.D topic opens in the SAME reader as the
 * Library (pdf, image, text, audio, video, office), with the same tools,
 * Ask tab, extraction offer and saved tabs. A catalogue topic is simply a
 * document SOURCE (file URL + content key) rather than a records row.
 */
import RecordTeachSession from '../../library/components/RecordTeachSession.jsx';

const mimeFor = (topic) => topic?.mime || (topic?.type === 'video' ? 'video/mp4'
  : topic?.type === 'audio' ? 'audio/mpeg'
  : 'application/pdf');

export default function PharmDTopicSession({ topic, course, onClose, chatState = 'ask' }) {
  const title = topic?.title || 'PHARM.D topic';
  if (!topic?.file_url) {
    return (
      <RecordTeachSession
        record={{ kind: 'upload', name: title, fileMissing: true, mime: '' }}
        onClose={onClose}
        chatState={chatState}
      />
    );
  }
  return (
    <RecordTeachSession
      source={{
        name: title,
        kind: 'upload',
        mime: mimeFor(topic),
        fileUrl: topic.file_url,
        contentKey: topic.contentKey || null,
        label: "PHARM.D · catalogue",
      }}
      downloadUrl={topic.file_url}
      onClose={onClose}
      chatState={chatState}
    />
  );
}
