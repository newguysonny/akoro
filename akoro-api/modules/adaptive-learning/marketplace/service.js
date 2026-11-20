import { v4 as uuid } from "uuid";
import { notify } from "../../notifications/index.js";
import {
  initializeTransaction,
  verifyTransaction,
  generateReference,
} from "../../../lib/paystackService.js";
import * as store from "./store.js";
import {
  APP_URL,
  pagination,
  listingSearchTerm,
  searchQueryTerm,
  validateNewListing,
  buildStyleSummary,
  sanitizeListingUpdates,
  isListingOwner,
  validateCheckout,
  isFreeListing,
  validateReview,
  validateSetDefault,
  isTrainedAgentPair,
  agentIdFromPair,
  buildPlatformAgents,
  mapPurchasedAgent,
} from "./rules.js";

export async function listListings(query) {
  const { limit, offset } = pagination(query);
  const listings = await store.listActiveListings({
    subject: query.subject,
    free:    query.free,
    term:    listingSearchTerm(query.q),
    limit,
    offset,
  });
  return { status: 200, body: { success: true, listings, count: listings.length } };
}

export async function getListing(listingId) {
  const listing = await store.getListingById(listingId);
  if (!listing) return { status: 404, body: { error: "Listing not found" } };
  return { status: 200, body: { success: true, listing } };
}

export async function listListingsBySubject(subject, query) {
  const { limit, offset } = pagination(query);
  const listings = await store.listListingsBySubject(subject, { limit, offset });
  return { status: 200, body: { success: true, listings, subject } };
}

export async function searchListings(query) {
  const { q, subject, limit = 20 } = query;
  if (!q) return { status: 400, body: { error: "q is required" } };

  const listings = await store.searchListings({
    term:    searchQueryTerm(q),
    subject,
    limit:   Number(limit),
  });
  return { status: 200, body: { success: true, listings, query: q } };
}

export async function createListing(teacherId, body) {
  const {
    agentId, title, description,
    subject, topicsCovered = [], previewTopics = [],
    priceKobo = 0, currency = "NGN",
    teacherName, teacherAvatar, sampleTip,
  } = body;

  const invalid = validateNewListing({ agentId, title, subject });
  if (invalid) return { status: 400, body: { error: invalid } };

  const config = await store.getAgentOrchestrationConfig(agentId);
  if (!config || config.teacher_id !== teacherId) {
    return { status: 403, body: { error: "Agent not found or does not belong to this teacher" } };
  }

  const listing = await store.insertListing({
    agent_id:       agentId,
    teacher_id:     teacherId,
    title,
    description,
    subject,
    topics_covered: topicsCovered,
    preview_topics: previewTopics,
    price_kobo:     priceKobo,
    currency,
    teacher_name:   teacherName,
    teacher_avatar: teacherAvatar,
    sample_tip:     sampleTip,
    style_summary:  buildStyleSummary(config),
  });

  return { status: 201, body: { success: true, listing } };
}

export async function updateListing(teacherId, listingId, body) {
  const existing = await store.getListingTeacherId(listingId);
  if (!isListingOwner(existing, teacherId)) {
    return { status: 403, body: { error: "Not authorised" } };
  }

  const listing = await store.updateListing(listingId, sanitizeListingUpdates(body));
  return { status: 200, body: { success: true, listing } };
}

export async function deleteListing(teacherId, listingId) {
  const existing = await store.getListingTeacherId(listingId);
  if (!isListingOwner(existing, teacherId)) {
    return { status: 403, body: { error: "Not authorised" } };
  }

  await store.deactivateListing(listingId);
  return { status: 200, body: { success: true, message: "Listing deactivated" } };
}

export async function checkout(studentId, body) {
  const { listingId, email: providedEmail } = body;

  const invalid = validateCheckout({ listingId });
  if (invalid) return { status: 400, body: { error: invalid } };

  const listing = await store.getActiveListing(listingId);
  if (!listing) {
    return { status: 404, body: { error: "Listing not found or inactive" } };
  }

  const existingPurchase = await store.getGrantedPurchase(studentId, listingId);
  if (existingPurchase) {
    return { status: 409, body: { error: "Already purchased", agentId: listing.agent_id } };
  }

  if (isFreeListing(listing)) {
    const purchaseId = uuid();
    await store.insertPurchase({
      id:              purchaseId,
      student_id:      studentId,
      agent_id:        listing.agent_id,
      listing_id:      listingId,
      amount_kobo:     0,
      currency:        listing.currency,
      paystack_ref:    `FREE-${purchaseId}`,
      paystack_status: "success",
      access_granted:  true,
      verified_at:     new Date(),
    });

    await store.grantAgentAccess(studentId, listing.agent_id, purchaseId);
    await store.incrementListingStudents(listingId);

    return {
      status: 200,
      body: {
        success:    true,
        free:       true,
        agentId:    listing.agent_id,
        purchaseId,
        message:    `${listing.title} is free — access granted immediately!`,
      },
    };
  }

  const email = providedEmail || await store.getUserEmail(studentId);
  if (!email) return { status: 400, body: { error: "email required for payment" } };

  const reference = generateReference("AGNT");
  const purchaseId = uuid();

  await store.insertPurchase({
    id:           purchaseId,
    student_id:   studentId,
    agent_id:     listing.agent_id,
    listing_id:   listingId,
    amount_kobo:  listing.price_kobo,
    currency:     listing.currency,
    paystack_ref: reference,
    paystack_status: "pending",
    metadata: {
      listing_title: listing.title,
      subject:       listing.subject,
      teacher_name:  listing.teacher_name,
    },
  });

  const paystack = await initializeTransaction({
    email,
    amount_kobo:  listing.price_kobo,
    reference,
    callback_url: `${APP_URL}/marketplace/payment/callback?purchaseId=${purchaseId}`,
    metadata: {
      purchase_id:   purchaseId,
      student_id:    studentId,
      listing_id:    listingId,
      agent_id:      listing.agent_id,
      listing_title: listing.title,
    },
  });

  return {
    status: 200,
    body: {
      success:           true,
      authorization_url: paystack.authorization_url,
      access_code:       paystack.access_code,
      reference,
      purchaseId,
      amount_kobo:       listing.price_kobo,
      currency:          listing.currency,
    },
  };
}

export async function verifyPayment(reference) {
  const purchase = await store.getPurchaseByReference(reference);
  if (!purchase) return { status: 404, body: { error: "Purchase not found" } };
  if (purchase.access_granted) {
    return { status: 200, body: { success: true, already_granted: true, agentId: purchase.agent_id } };
  }

  const tx = await verifyTransaction(reference);

  if (tx.status === "success") {
    await store.grantAgentAccess(purchase.student_id, purchase.agent_id, purchase.id);
    await store.incrementListingStudents(purchase.listing_id);

    return {
      status: 200,
      body: {
        success:      true,
        agentId:      purchase.agent_id,
        amount_kobo:  tx.amount,
        paid_at:      tx.paid_at,
        message:      "Payment verified — agent access granted!",
      },
    };
  }

  await store.updatePurchasePaystackStatus(purchase.id, tx.status);
  return { status: 200, body: { success: false, status: tx.status, message: "Payment not successful" } };
}

export async function handlePaymentCallback({ reference, purchaseId }) {
  if (!reference) return `${APP_URL}/marketplace?payment=cancelled`;

  const tx = await verifyTransaction(reference);

  if (tx.status === "success") {
    const purchase = await store.getCallbackPurchase(reference);

    if (purchase && !purchase.access_granted) {
      await store.grantAgentAccess(purchase.student_id, purchase.agent_id, purchaseId);
      await store.incrementListingStudents(purchase.listing_id);
    }

    return `${APP_URL}/marketplace?payment=success&agentId=${purchase?.agent_id}&reference=${reference}`;
  }

  return `${APP_URL}/marketplace?payment=failed&reference=${reference}`;
}

export async function getMyAgents(userId) {
  const prefs = await store.getUserAgentPreferences(userId);

  const defaultPairId   = prefs?.default_pair_id  || "nana-sargeant";
  const purchasedAgents = prefs?.purchased_agents || [];
  const activeAgentId   = prefs?.active_agent_id  || null;

  let purchasedProfiles = [];
  if (purchasedAgents.length > 0) {
    purchasedProfiles = await store.getActiveListingProfiles(purchasedAgents);
  }

  const platformAgents = buildPlatformAgents({ defaultPairId, activeAgentId });
  const purchased = purchasedProfiles.map((profile) =>
    mapPurchasedAgent(profile, { defaultPairId, activeAgentId })
  );

  return {
    status: 200,
    body: {
      success:          true,
      userId,
      defaultPairId,
      activeAgentId,
      platformAgents,
      purchasedAgents:  purchased,
      totalAgents:      platformAgents.length + purchased.length,
    },
  };
}

export async function setDefaultAgent(userId, body) {
  const { agentPairId, activeAgentId } = body;

  const invalid = validateSetDefault({ agentPairId });
  if (invalid) return { status: 400, body: { error: invalid } };

  if (isTrainedAgentPair(agentPairId)) {
    const owns = await store.userOwnsAgent(userId, agentIdFromPair(agentPairId));
    if (!owns) {
      return { status: 403, body: { error: "You do not own this agent" } };
    }
  }

  await store.upsertUserAgentPreferences({
    user_id:         userId,
    default_pair_id: agentPairId,
    active_agent_id: activeAgentId || null,
    updated_at:      new Date(),
  });

  return { status: 200, body: { success: true, userId, defaultPairId: agentPairId } };
}

export async function getPurchases(userId) {
  const purchases = await store.listPurchases(userId);
  return { status: 200, body: { success: true, purchases } };
}

export async function submitReview(studentId, body) {
  const { listingId, rating, reviewText } = body;

  const invalid = validateReview({ listingId, rating });
  if (invalid) return { status: 400, body: { error: invalid } };

  const purchase = await store.getReviewablePurchase(studentId, listingId);
  if (!purchase) {
    return { status: 403, body: { error: "You must purchase this agent before reviewing" } };
  }

  const review = await store.upsertReview({
    listing_id:  listingId,
    student_id:  studentId,
    purchase_id: purchase.id,
    rating,
    review_text: reviewText || null,
  });

  return { status: 201, body: { success: true, review } };
}

export async function getReviews(listingId, query) {
  const { limit, offset } = pagination(query);
  const reviews = await store.listReviews(listingId, { limit, offset });
  return { status: 200, body: { success: true, reviews } };
}

export async function fulfillMarketplaceEvent(event) {
  if (event.event === "charge.success") {
    const { reference, metadata, status } = event.data;

    if (status !== "success") return false;

    if (metadata?.kind === "platform_tool") {
      const row = await store.getInstructorToolAccess(reference);

      if (row && !row.access_granted) {
        await store.grantInstructorToolAccess(row.id);

        if (global._io && row.instructor_id) {
          const payload = {
            toolId:    metadata.tool_id,
            toolName:  metadata.tool_name,
            message:   `🔓 "${metadata.tool_name}" unlocked for your agent.`,
            timestamp: new Date().toISOString(),
          };
          global._io.to(`user:${row.instructor_id}`).emit("tool_unlocked", payload);
          global._io.to(`instructor:${row.instructor_id}`).emit("tool_unlocked", payload);
        }
        notify.toolUnlocked({ instructorId: row.instructor_id, toolName: metadata.tool_name });
        console.log(`[Webhook] ✅ Tool unlocked: instructor=${row.instructor_id} tool=${metadata.tool_id}`);
      }
      return true;
    }

    const purchaseId = metadata?.purchase_id;
    const studentId  = metadata?.student_id;
    const agentId    = metadata?.agent_id;
    const listingId  = metadata?.listing_id;

    if (!purchaseId || !studentId || !agentId) return false;

    const purchase = await store.getPurchaseFulfillment(purchaseId);

    if (!purchase || purchase.access_granted) {
      return true;
    }

    await store.grantAgentAccess(studentId, agentId, purchaseId);
    await store.incrementListingStudents(listingId);

    if (global._io) {
      global._io.to(`student:${studentId}`).emit("agent_purchased", {
        agentId,
        listingId,
        agentName:  metadata?.listing_title || "Agent",
        purchaseId,
        message:    `🎉 Agent unlocked! You can now use "${metadata?.listing_title}" for your sessions.`,
        timestamp:  new Date().toISOString(),
      });
    }

    notify.agentUnlocked({ userId: studentId, agentName: metadata?.listing_title || "Teaching guide" });
    console.log(`[Webhook] ✅ Access granted: student=${studentId} agent=${agentId}`);
    return true;
  }

  if (event.event === "refund.processed") {
    const { transaction_reference } = event.data;
    await store.revokeAgentPurchaseByReference(transaction_reference);
    return true;
  }

  return false;
}
