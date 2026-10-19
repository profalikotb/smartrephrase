/**
 * Single source of truth for every time budget in the app.
 * Server limits are the provider-facing limits; client limits add a small grace
 * so the server can report its own timeout as a structured error first.
 */
export interface TimeoutConfig {
  firstContentMs: number;
  inactivityMs: number;
  overallMs: number;
  clientGraceMs: number;
  maxAutoRetries: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  minAttemptBudgetMs: number;
  renderFlushMs: number;
}

export const TIMEOUTS: Readonly<TimeoutConfig> = {
  /** Max wait for the first generated text, per attempt. */
  firstContentMs: 15_000,
  /** Max gap between streamed chunks once text has started. */
  inactivityMs: 12_000,
  /** Overall operation deadline including all retries and backoff. Always wins. */
  overallMs: 45_000,
  /** Extra grace the client allows on per-attempt timers. */
  clientGraceMs: 2_500,
  /** Bounded automatic retries (on top of the first attempt). */
  maxAutoRetries: 2,
  backoffBaseMs: 800,
  backoffMaxMs: 6_000,
  /** Never start an attempt with less than this remaining in the overall budget. */
  minAttemptBudgetMs: 4_000,
  /** UI streaming flush interval. */
  renderFlushMs: 50,
};

/** Vercel function limit must exceed one attempt's maximum server-side duration. */
export const SERVER_MAX_DURATION_S = 60;

/** Full jitter exponential backoff, clamped to the remaining budget. */
export function backoffDelay(retryIndex: number, random: () => number = Math.random, baseMs: number = TIMEOUTS.backoffBaseMs, maxMs: number = TIMEOUTS.backoffMaxMs): number {
  const exp = Math.min(maxMs, baseMs * 2 ** retryIndex);
  return Math.round(exp / 2 + random() * (exp / 2));
}
