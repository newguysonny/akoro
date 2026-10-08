import { useEffect, useState } from 'react';

/**
 * useDebouncedValue — the value, delayed.
 *
 * Search inputs call the database through this: keystrokes update the box
 * instantly, the debounced value drives the fetch, so a six-letter query
 * is one request instead of six. 300ms sits under the feel of "instant"
 * and well above the pace of fast typing.
 */
export default function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
