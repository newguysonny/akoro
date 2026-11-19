/**
 * lib/verificationAssertions.js — the deterministic assertion helpers the
 * self-tooling pipeline uses to score a built tool, installed at boot
 * (Phase 19 step 2). self-tooling reads this instead of importing
 * modules/verify internals, so the verification harness is not part of a
 * production import cycle.
 */
let assertions = null;

export function setVerificationAssertions(next) {
  assertions = next;
}

/** → { createExpect, repeatVerdict } */
export function verificationAssertions() {
  if (!assertions) throw new Error("Verification assertions used before installation (setVerificationAssertions at boot).");
  return assertions;
}
