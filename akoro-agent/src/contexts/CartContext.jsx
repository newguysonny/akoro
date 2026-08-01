/**
 * CartContext — a local, wallet-based cart (unlike the learner app's
 * server-side cart). Voucher purchases debit the agent's prepaid wallet
 * synchronously — no Paystack redirect to survive — so there's nothing a
 * server-side cart buys you here; localStorage keeps it simple and still
 * persists across a reload/tab close.
 */
import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const CartContext = createContext(null);
const KEY = 'akoro_agent_cart';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}
function save(items) {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* storage full/unavailable */ }
}
function newCartId() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function CartProvider({ children }) {
  const [items, setItems] = useState(load);
  useEffect(() => { save(items); }, [items]);

  // item shape:
  //  type 'product': { type, startupId, startupName, coverImageUrl, category, productId, productName, imageUrl, billingPeriod, unitCredits, unitPriceUsd, minOrderQty, quantity }
  //  type 'custom':  { type, startupId, startupName, coverImageUrl, category, unitCredits, unitPriceUsd, discountPct, quantity }
  const addItem = useCallback((item) => {
    setItems((prev) => [...prev, { ...item, cartId: newCartId() }]);
  }, []);
  const removeItem = useCallback((cartId) => setItems((prev) => prev.filter((i) => i.cartId !== cartId)), []);
  const updateQty = useCallback((cartId, quantity) => setItems((prev) => prev.map((i) => (i.cartId === cartId ? { ...i, quantity } : i))), []);
  const clear = useCallback(() => setItems([]), []);

  const count = items.reduce((s, i) => s + 1, 0);   // orders in the cart, not total codes
  const subtotal = items.reduce((s, i) => s + i.unitPriceUsd * i.quantity, 0);

  return (
    <CartContext.Provider value={{ items, addItem, removeItem, updateQty, clear, count, subtotal }}>
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => useContext(CartContext) || {
  items: [], addItem: () => {}, removeItem: () => {}, updateQty: () => {}, clear: () => {}, count: 0, subtotal: 0,
};
