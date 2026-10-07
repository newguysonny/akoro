import { useRef, useState } from 'react';

/**
 * useInFlight — one request at a time, guaranteed.
 *
 * On a flaky connection, tapping a create/submit button repeatedly fired
 * repeated POSTs (duplicate activities, duplicate communities) because a
 * useState guard only applies AFTER the next render — a same-frame double
 * tap sails straight through it. The lock here is a REF: it flips
 * synchronously inside the first call, so every later tap while the request
 * is in the air is dropped, and `busy` (state) drives the button's loading
 * UI.
 *
 *   const { busy, run } = useInFlight();
 *   const save = () => run(async () => { await apiPost(...); });
 *   <button disabled={busy} onClick={save}>{busy ? <Spinner/> : 'Save'}</button>
 */
export function useInFlight() {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = async (fn) => {
    if (lock.current) return undefined;   // a request is already in the air
    lock.current = true;
    setBusy(true);
    try {
      return await fn();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return { busy, run };
}
