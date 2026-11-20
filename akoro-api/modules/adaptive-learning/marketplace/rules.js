export const APP_URL = process.env.APP_URL || "http://localhost:3000";

export function pagination(query = {}) {
  const { limit = 20, offset = 0 } = query;
  return { limit: Number(limit), offset: Number(offset) };
}

export function listingSearchTerm(raw) {
  return String(raw ?? "").replace(/[,()%\\]/g, " ").trim().slice(0, 80);
}

export function searchQueryTerm(raw) {
  return String(raw).replace(/[,()%*:\\]/g, " ");
}

export function validateNewListing({ agentId, title, subject }) {
  if (!agentId || !title || !subject) return "agentId, title and subject required";
  return null;
}

export function buildStyleSummary(config) {
  return config.guide_config?.personality
    ? config.guide_config.personality.substring(0, 150)
    : `${config.guide_config?.tone || "Engaging"} teaching style — ${config.flow_type} approach`;
}

const LISTING_UPDATE_FIELDS = [
  "title", "description", "topics_covered", "preview_topics",
  "price_kobo", "is_active", "teacher_avatar", "sample_tip", "style_summary",
];

export function sanitizeListingUpdates(body) {
  const { teacherId: _ignored, ...updates } = body;
  const safeUpdates = Object.fromEntries(
    Object.entries(updates).filter(([key]) => LISTING_UPDATE_FIELDS.includes(key))
  );
  safeUpdates.updated_at = new Date();
  return safeUpdates;
}

export function isListingOwner(existing, teacherId) {
  return Boolean(existing) && existing.teacher_id === teacherId;
}

export function validateCheckout({ listingId }) {
  if (!listingId) return "listingId required";
  return null;
}

export function isFreeListing(listing) {
  return listing.price_kobo === 0;
}

export function validateReview({ listingId, rating }) {
  if (!listingId || !rating) return "listingId and rating required";
  if (rating < 1 || rating > 5) return "rating must be 1–5";
  return null;
}

export function validateSetDefault({ agentPairId }) {
  if (!agentPairId) return "agentPairId required";
  return null;
}

export function isTrainedAgentPair(agentPairId) {
  return agentPairId !== "nana-esumai" && agentPairId.startsWith("trained:");
}

export function agentIdFromPair(agentPairId) {
  return agentPairId.replace("trained:", "");
}

export function buildPlatformAgents({ defaultPairId, activeAgentId }) {
  return [
    {
      id:          "nana-esumai",
      type:        "platform",
      name:        "NaNa Esumai & Sargeant",
      description: "Platform default — NaNa coaches your teaching quality. Sargeant gates advancement.",
      subject:     "All subjects",
      avatar:      "🧠",
      isFree:      true,
      isDefault:   !defaultPairId || defaultPairId === "nana-esumai" || defaultPairId === "nana-sargeant",
      isActive:    !activeAgentId || activeAgentId === "nana-esumai",
    },
  ];
}

export function mapPurchasedAgent(profile, { defaultPairId, activeAgentId }) {
  return {
    id:          `trained:${profile.agent_id}`,
    agentId:     profile.agent_id,
    listingId:   profile.id,
    type:        "trained",
    name:        profile.title,
    subject:     profile.subject,
    teacherName: profile.teacher_name,
    avatar:      profile.teacher_avatar || "🎓",
    styleSummary: profile.style_summary,
    rating:      profile.avg_rating,
    isFree:      false,
    isPurchased: true,
    isDefault:   defaultPairId === `trained:${profile.agent_id}`,
    isActive:    activeAgentId  === profile.agent_id,
  };
}
