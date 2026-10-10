/*
 * speech.js — turning a chat reply into something worth hearing.
 * Markdown, citation tags ([T1], [2]) and links are for eyes, not ears.
 */
const MAX_SPOKEN = 1500;

/** A reply as plain sentences for text-to-speech (cut at a sentence near MAX_SPOKEN). */
export function speakableText(markdown) {
  let s = String(markdown ?? '')
    .replace(/```[\s\S]*?```/g, ' ')                 // code blocks aren't read out
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')           // images
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1')     // links → their words
    .replace(/\[(?:T?\d+)\]/g, '')                   // [T1] [2] citation tags
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')              // headings
    .replace(/^\s*[-*•]\s+/gm, '')                   // bullets
    .replace(/^\s*\d+[.)]\s+/gm, '')                 // numbered lists
    .replace(/(\*\*|__|\*|_|~~)(.+?)\1/g, '$2')      // bold / italic / strike
    .replace(/^>\s?/gm, '')
    .replace(/\|/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/\.(\s*\.)+/g, '.')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (s.length > MAX_SPOKEN) {
    const cut = s.slice(0, MAX_SPOKEN);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
    s = end > MAX_SPOKEN / 2 ? cut.slice(0, end + 1) : cut;
  }
  return s;
}
