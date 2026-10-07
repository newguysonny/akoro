/**
 * lazyWithRetry — React.lazy that auto-recovers from a stale chunk after a
 * deploy. When a new version ships, hashed route chunks get new filenames and
 * the old ones 404, so a tab opened before the deploy throws
 * "Failed to fetch dynamically imported module" on the next navigation.
 * The recovery (reload once) lives in chunkRetry.js.
 */
import { lazy } from 'react';
import { retryImport } from './chunkRetry.js';

export function lazyWithRetry(factory) {
  return lazy(() => retryImport(factory));
}
