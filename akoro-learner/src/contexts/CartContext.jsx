/**
 * CartContext — shares the unified cart (courses + agents) and its item count
 * across the app so the badge and pages stay in sync. Fetches lazily and after
 * every mutation.
 */
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as cartApi from '../services/cartApi.js';

const CartContext = createContext(null);

const hasSession = () => { try { return !!localStorage.getItem('akoro_user'); } catch { return false; } };

export function CartProvider({ children }) {
  const [cart, setCart] = useState({ items: [], item_count: 0, subtotal_ngn: 0, subtotal_kobo: 0 });
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!hasSession()) return;
    setLoading(true);
    try { setCart(await cartApi.getCart()); } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const inCart = useCallback((key) =>
    (cart.items || []).some((i) => i.course_id === key || i.listing_id === key), [cart]);

  const addCourse = useCallback(async (courseId) => { await cartApi.addCourseToCart(courseId); await refresh(); }, [refresh]);
  const addAgent  = useCallback(async (listingId) => { await cartApi.addAgentToCart(listingId); await refresh(); }, [refresh]);
  const removeCourse = useCallback(async (courseId) => { await cartApi.removeCourseFromCart(courseId); await refresh(); }, [refresh]);
  const removeAgent  = useCallback(async (listingId) => { await cartApi.removeAgentFromCart(listingId); await refresh(); }, [refresh]);

  return (
    <CartContext.Provider value={{ cart, count: cart.item_count || 0, loading, refresh, inCart, addCourse, addAgent, removeCourse, removeAgent }}>
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => useContext(CartContext) || {
  cart: { items: [] }, count: 0, loading: false, refresh: () => {}, inCart: () => false,
  addCourse: () => {}, addAgent: () => {}, removeCourse: () => {}, removeAgent: () => {},
};
