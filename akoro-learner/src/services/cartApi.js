/**
 * cartApi.js — unified cart (courses + agent teaching-guides).
 * The backend cart holds both; one checkout pays for everything together.
 */
import { apiGet, apiPost, apiDelete } from './api.js';

export const getCart              = () => apiGet('/api/cart').then((r) => r.data ?? r);
export const addCourseToCart      = (course_id) => apiPost('/api/cart', { course_id });
export const addAgentToCart       = (listing_id) => apiPost('/api/cart', { item_type: 'agent', listing_id });
export const removeCourseFromCart = (courseId)  => apiDelete(`/api/cart/${courseId}`);
export const removeAgentFromCart  = (listingId) => apiDelete(`/api/cart/listing/${listingId}`);
export const clearCart            = () => apiDelete('/api/cart');
export const applyCoupon          = (coupon_code) => apiPost('/api/cart/apply-coupon', { coupon_code });
export const verifyCheckout       = (reference) => apiGet(`/api/cart/verify/${encodeURIComponent(reference)}`).then((r) => r.data ?? r);
export const checkoutCart         = ({ coupon_code, method, voucher_code } = {}) =>
  apiPost('/api/cart/checkout', {
    ...(coupon_code ? { coupon_code } : {}),
    ...(method ? { method } : {}),
    ...(voucher_code ? { voucher_code } : {}),
  });
