/**
 * ordersApi — the learner's payment/order history.
 * Merges course + cart payments (the payments ledger) with direct agent
 * (teaching-guide) purchases. Cart-bought agents are excluded from the agent
 * list since they're already represented by their cart order.
 */
import { apiGet } from './api.js';

export const getTransactions = () =>
  apiGet('/api/transactions?limit=100').then((r) => r.data ?? r ?? []);

export const getAgentPurchases = () =>
  apiGet('/api/adaptive/marketplace/purchases/me')
    .then((r) => r.purchases ?? r.data?.purchases ?? [])
    .catch(() => []);

// Normalise both sources into one chronological order list.
export async function getOrderHistory() {
  const [txns, agents] = await Promise.all([
    getTransactions().catch(() => []),
    getAgentPurchases(),
  ]);

  const fromTxns = (txns || []).map((p) => {
    const meta = p.provider_response || {};
    const isCart = !!meta.is_cart_checkout;
    return {
      id:        `pay_${p.id}`,
      kind:      isCart ? 'order' : 'course',
      title:     isCart
        ? `${meta.item_count || (meta.course_ids?.length || 0) + (meta.listing_ids?.length || 0)} items`
        : (p.courses?.title || 'Course'),
      subtitle:  isCart ? 'Cart order' : (p.courses?.users?.full_name || 'Course'),
      amount_ngn: (p.amount_paid || 0) / 100,
      currency:  p.currency || 'NGN',
      status:    p.status,                       // success | pending | refunded | failed
      reference: p.provider_reference || null,
      date:      p.paid_at || p.created_at,
    };
  });

  const fromAgents = (agents || [])
    // Cart-bought agents already appear as their cart order — drop them here.
    .filter((a) => !String(a.paystack_ref || '').startsWith('akoro_cart_'))
    .map((a) => ({
      id:        `agent_${a.id}`,
      kind:      'agent',
      title:     a.marketplace_listings?.title || 'Teaching guide',
      subtitle:  a.marketplace_listings?.teacher_name || 'Teaching guide',
      amount_ngn: (a.amount_kobo || 0) / 100,
      currency:  a.currency || 'NGN',
      status:    a.access_granted ? 'success' : (a.paystack_status || 'pending'),
      reference: a.paystack_ref || null,
      date:      a.purchased_at,
    }));

  return [...fromTxns, ...fromAgents]
    .sort((x, y) => new Date(y.date || 0) - new Date(x.date || 0));
}
