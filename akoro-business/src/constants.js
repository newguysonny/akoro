export const BRAND = '#111827';   // deep ink — business/admin tone (not the consumer purple)
export const ACCENT = '#6C3BFF';
export const GREEN  = '#10B981';
export const RED    = '#EF4444';
export const AMBER  = '#F59E0B';
export const INK    = '#111827';
export const MUTED  = '#6B7280';
export const MUTED2 = '#9CA3AF';
export const BORDER = '#E5E7EB';
export const LIGHT  = '#F9FAFB';
export const WHITE  = '#FFFFFF';
export const FONT   = "'Nunito', sans-serif";

// Matches akoro-api/modules/vouchers/startups.js CATEGORIES + the DB check
// constraint in migrations/2026-vouchers-marketplace-media.sql.
export const CATEGORIES = {
  education:    { label: 'Education',    icon: '🎓' },
  fintech:      { label: 'Fintech',      icon: '💳' },
  gaming:       { label: 'Gaming',       icon: '🎮' },
  productivity: { label: 'Productivity', icon: '⚡' },
  health:       { label: 'Health',       icon: '🩺' },
  ecommerce:    { label: 'E-commerce',   icon: '🛍️' },
  other:        { label: 'Other',        icon: '🏢' },
};
