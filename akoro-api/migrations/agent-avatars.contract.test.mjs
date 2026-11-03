import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Agent avatars contract — drawn, never emoji.
 *
 * The learner app's nav icons are hand-drawn SVGs (NavIcons.jsx);
 * avatars now get the same treatment (AgentAvatar.jsx): every avatar a
 * learner can pick — agent glyphs and profile portraits — is a drawn
 * character on the 48×48 ink-outline grid. The stored emoji strings
 * stay as DB keys only, never rendered as glyphs, so no data, API or
 * agent identity changes; existing agents keep their look.
 */
const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const [avatars, navIcons, onboard, noAgent, shared, sheets, chat, stats, blocks, chatView, voice, battle, parts, constants, en, ar, es] = await Promise.all([
  read("../../akoro-learner/src/components/common/AgentAvatar.jsx"),
  read("../../akoro-learner/src/components/common/NavIcons.jsx"),
  // Onboarding is a chat now (2026-11-01): its avatar keys live in lib/onboardingChat.js, its picker in onboarding/Cards.jsx.
  Promise.all(["../../akoro-learner/src/pages/OnboardingPage.jsx", "../../akoro-learner/src/lib/onboardingChat.js", "../../akoro-learner/src/pages/onboarding/Cards.jsx"].map(read)).then((parts) => parts.join("\n")),
  read("../../akoro-learner/src/components/battles/NoAgentSheet.jsx"),
  read("../../akoro-learner/src/pages/settings/shared.jsx"),
  read("../../akoro-learner/src/pages/settings/sheets.jsx"),
  read("../../akoro-learner/src/components/tabs/AgentChatTab.jsx"),
  read("../../akoro-learner/src/components/tabs/AgentStatsTab.jsx"),
  read("../../akoro-learner/src/components/sessions/BlockRenderer.jsx"),
  read("../../akoro-learner/src/components/teaching/SessionChatView.jsx"),
  read("../../akoro-learner/src/components/assessment/VoiceExam.jsx"),
  read("../../akoro-learner/src/components/battles/BattleModal.jsx"),
  read("../../akoro-learner/src/pages/course-details/parts.jsx"),
  read("../../akoro-learner/src/constants.js"),
  read("../../akoro-learner/src/contexts/i18n/en.js"),
  read("../../akoro-learner/src/contexts/i18n/ar.js"),
  read("../../akoro-learner/src/contexts/i18n/es.js"),
]);

/* The emoji keys each surface can store — every one must have a drawing. */
const keyList = (src, name) => {
  const m = src.match(new RegExp(`const ${name}\\s*=\\s*\\[(.*?)\\];`, "s"));
  assert.ok(m, `${name} found`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
};
const norm = (s) => s.replace(/\uFE0F/g, "");
const normAll = (src) => norm(src);

test("every pickable avatar key has a drawing", () => {
  // The set: same craft as NavIcons — 48-grid, ink outlines, palette.
  assert.ok(avatars.includes('viewBox="0 0 48 48"'), "48×48 grid like NavIcons");
  assert.ok(avatars.includes('strokeWidth="2"'), "ink outlines at 2px");
  assert.ok(navIcons.includes('viewBox="0 0 48 48"'), "NavIcons is the reference set");
  assert.ok(avatars.includes("export function AgentAvatar"), "AgentAvatar export");
  assert.ok(avatars.includes("export function ProfileAvatar"), "ProfileAvatar export");
  assert.ok(avatars.includes("export function DrawnAvatar"), "DrawnAvatar combined lookup");
  assert.ok(avatars.includes("|| BotAvatar"), "unknown agent keys fall back to the bot");
  assert.ok(avatars.includes("BARE_PORTRAIT"), "unknown profile keys fall back to the bare portrait");

  const drawn = normAll(avatars);
  const keys = new Set([
    ...keyList(onboard, "GUIDE_EMOJIS"),
    ...keyList(noAgent, "EMOJIS"),
    ...keyList(shared, "EMOJI_LIST"),
    ...keyList(shared, "AVATAR_LIST"),
  ]);
  // The guide styles + the historic default are keys too.
  for (const k of ["\u{1F9E0}", "\u26A1", "\u{1F916}"]) keys.add(k);
  const missing = [...keys].filter((k) => !drawn.includes(norm(k)));
  assert.deepEqual(missing, [], "every pickable key appears in the drawn set");
});

test("no surface renders an avatar emoji as a glyph", () => {
  // The pickers draw the choices; the stored string is only ever a key.
  assert.ok(onboard.includes("<AgentAvatar emoji={em}"), "onboarding picker draws");
  assert.ok(!/>\s*\{(?:em|emoji|ans\.agentEmoji)\}\s*</.test(onboard), "onboarding has no raw emoji render");
  assert.ok(noAgent.includes("<DrawnAvatar emoji={em}"), "no-agent picker draws");
  assert.ok(sheets.includes("<DrawnAvatar emoji={em}"), "settings picker draws");
  assert.ok(shared.includes("<DrawnAvatar emoji={emoji}"), "settings AvatarCircle draws");
  assert.ok(!shared.includes("{emoji}</span>"), "AvatarCircle has no raw glyph branch");

  // Every render site goes through the drawn set.
  const sites = {
    "chat bubbles": chat,
    "agent stats header": stats,
    "session blocks": blocks,
    "session chat view": chatView,
    "voice exam orb": voice,
    "battle arena": battle,
    "course pages Avatar": parts,
  };
  for (const [label, src] of Object.entries(sites)) {
    assert.ok(src.includes("AgentAvatar") || src.includes("DrawnAvatar"), `${label} renders the drawn set`);
    assert.ok(!/>\s*\{(?:agentEmoji|p\?\.agentEmoji|p\.agentEmoji|teacher\.agentEmoji|nana\.emoji|student\.emoji|em)\}\s*</.test(src), `${label} has no raw emoji render`);
  }

  // The greeting sentence no longer embeds an emoji glyph.
  for (const [label, src] of [["en", en], ["ar", ar], ["es", es]]) {
    assert.ok(!src.includes("{emoji}"), `${label} greeting has no emoji placeholder`);
  }
  assert.ok(!chat.includes(".replace('{emoji}'"), "chat no longer injects the emoji into text");});

test("agent identity data is untouched — keys in, drawings out", () => {
  // AGENT_STYLES keeps its emoji keys (prompts + identity), rendered drawn.
  assert.ok(constants.includes('emoji:"\u{1F9E0}"'), "NaNa keeps her key");
  assert.ok(blocks.includes('<AgentAvatar emoji={nana.emoji}'), "NaNa renders drawn");
  assert.ok(blocks.includes('<AgentAvatar emoji={student.emoji}'), "the learner's agent renders drawn");
  // The DB column is still the source of truth.
  assert.ok(battle.includes("agent_emoji ?? p.agentEmoji"), "battle state still reads the stored key");
  assert.ok(battle.includes("<AgentAvatar emoji={p?.agentEmoji}"), "battle pills draw it");
});
