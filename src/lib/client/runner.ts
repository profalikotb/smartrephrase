import { AUTO_RETRYABLE, isErrorCode, type ErrorCode } from "@/lib/shared/errors";
import { NdjsonParser, type ApiErrorBody, type FinishKind } from "@/lib/shared/protocol";
import { TIMEOUTS, backoffDelay } from "@/lib/shared/timeouts";
import type { RephraseRequest } from "@/lib/shared/options";

export type RunEvent =
  | { type: "connecting"; attempt: number }
  | { type: "retrying"; attempt: number; delayMs: number; code: ErrorCode }
  | { type: "generating" }
  | { type: "delta"; text: string }
  | { type: "completed"; finish: FinishKind; model?: string; reason?: string }
  | { type: "failed"; code: ErrorCode; partial: boolean; retryAfter?: number };

export interface RunnerDeps {
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  random: () => number;
  isOnline: () => boolean;
  timeouts?: Partial<typeof TIMEOUTS>;
  endpoint?: string;
}

export type RunInput = Omit<RephraseRequest, "attempt" | "useFallback" | "budgetMs">;

class ClientTimeout extends Error {
  constructor(public code: ErrorCode) {
    super(code);
  }
}

export const abortableSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });

/**
 * Runs one rephrase *operation*: up to 1 + maxAutoRetries attempts inside a single overall deadline.
 * Emits events through `emit`; after `signal` aborts, nothing more is emitted (late results are dropped).
 * Each attempt maps to exactly one upstream provider call (server/SDK retries are disabled).
 */
export async function runRephrase(input: RunInput, signal: AbortSignal, emit: (e: RunEvent) => void, deps: RunnerDeps): Promise<void> {
  const T = { ...TIMEOUTS, ...deps.timeouts };
  const deadlineAt = deps.now() + T.overallMs;
  const safeEmit = (e: RunEvent) => {
    if (!signal.aborted) emit(e);
  };
  let useFallback = false;
  let lastCode: ErrorCode | undefined;
  let lastRetryAfter: number | undefined;

  for (let attempt = 0; attempt <= T.maxAutoRetries; attempt++) {
    if (signal.aborted) return;
    if (!deps.isOnline()) return safeEmit({ type: "failed", code: "offline", partial: false });
    const remaining = deadlineAt - deps.now();
    if (remaining < T.minAttemptBudgetMs) return safeEmit({ type: "failed", code: lastCode ?? "timeout_overall", partial: false, retryAfter: lastRetryAfter });

    safeEmit({ type: "connecting", attempt });
    const outcome = await attemptOnce({ ...input, attempt, useFallback, budgetMs: Math.max(1000, Math.floor(remaining)) }, signal, safeEmit, deps, T, deadlineAt);
    if (signal.aborted) return;
    if (outcome.kind === "done") return;

    const { code, retryAfter, partial } = outcome;
    lastCode = code;
    lastRetryAfter = retryAfter;
    // After any text has streamed, never retry automatically (no concatenation of restarted output).
    if (partial || !AUTO_RETRYABLE.has(code) || attempt === T.maxAutoRetries) return safeEmit({ type: "failed", code, partial, retryAfter });

    const delayMs = retryAfter !== undefined ? retryAfter * 1000 : backoffDelay(attempt, deps.random, T.backoffBaseMs, T.backoffMaxMs);
    if (deps.now() + delayMs + T.minAttemptBudgetMs > deadlineAt) return safeEmit({ type: "failed", code, partial: false, retryAfter });
    if (code === "model_unavailable" || code === "provider_overloaded") useFallback = true;

    safeEmit({ type: "retrying", attempt: attempt + 1, delayMs, code });
    try {
      await deps.sleep(delayMs, signal);
    } catch {
      return; // cancelled during backoff — caller already moved to "cancelled"
    }
  }
}

type AttemptOutcome = { kind: "done" } | { kind: "failed"; code: ErrorCode; partial: boolean; retryAfter?: number };

async function attemptOnce(
  body: RephraseRequest,
  outer: AbortSignal,
  emit: (e: RunEvent) => void,
  deps: RunnerDeps,
  T: typeof TIMEOUTS,
  deadlineAt: number,
): Promise<AttemptOutcome> {
  const ctl = new AbortController();
  const onOuter = () => ctl.abort(outer.reason);
  outer.addEventListener("abort", onOuter, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let gotText = false;
  let timeoutCode: ErrorCode | undefined;

  const arm = () => {
    if (timer) clearTimeout(timer);
    const phase = gotText ? T.inactivityMs + T.clientGraceMs : T.firstContentMs + T.clientGraceMs;
    const remaining = deadlineAt - deps.now();
    const overall = remaining <= phase;
    timer = setTimeout(() => {
      timeoutCode = overall ? "timeout_overall" : gotText ? "timeout_inactivity" : "timeout_first_content";
      ctl.abort(new ClientTimeout(timeoutCode));
    }, Math.max(0, Math.min(phase, remaining)));
  };

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    arm();
    const res = await deps.fetch(deps.endpoint ?? "/api/rephrase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
      cache: "no-store",
      credentials: "same-origin",
    });

    if (!res.ok || !res.body) {
      const err = await readError(res);
      const headerRetry = Number(res.headers.get("retry-after"));
      return { kind: "failed", code: err.code, partial: false, retryAfter: err.retryAfter ?? (Number.isFinite(headerRetry) && headerRetry > 0 ? headerRetry : undefined) };
    }

    reader = res.body.getReader();
    const parser = new NdjsonParser();
    let model: string | undefined;
    const handle = (ev: ReturnType<NdjsonParser["push"]>[number]): AttemptOutcome | undefined => {
      switch (ev.type) {
        case "start":
          model = ev.model;
          return undefined;
        case "delta":
          if (!ev.text) return undefined;
          if (!gotText) {
            gotText = true;
            emit({ type: "generating" });
          }
          arm();
          emit({ type: "delta", text: ev.text });
          return undefined;
        case "done":
          emit({ type: "completed", finish: ev.finish, model, reason: ev.reason });
          return { kind: "done" };
        case "error":
          return { kind: "failed", code: isErrorCode(ev.error.code) ? ev.error.code : "bad_response", partial: gotText };
      }
    };
    while (true) {
      const { done, value } = await reader.read();
      const events = done ? parser.end() : parser.push(value);
      for (const ev of events) {
        const out = handle(ev);
        if (out) return out;
      }
      if (done) return { kind: "failed", code: "interrupted", partial: gotText };
    }
  } catch (e) {
    if (outer.aborted) return { kind: "failed", code: "cancelled", partial: gotText };
    if (timeoutCode) return { kind: "failed", code: timeoutCode, partial: gotText };
    if (e instanceof ClientTimeout) return { kind: "failed", code: e.code, partial: gotText };
    return { kind: "failed", code: deps.isOnline() ? "network" : "offline", partial: gotText };
  } finally {
    if (timer) clearTimeout(timer);
    outer.removeEventListener("abort", onOuter);
    if (reader) reader.cancel().catch(() => undefined);
    if (!ctl.signal.aborted) ctl.abort(); // release the connection in every exit path
  }
}

async function readError(res: Response): Promise<ApiErrorBody> {
  try {
    const j = (await res.json()) as { error?: Partial<ApiErrorBody> };
    const code = j.error?.code;
    if (isErrorCode(code)) return { code, retryable: Boolean(j.error?.retryable), retryAfter: j.error?.retryAfter };
  } catch {
    /* non-JSON (e.g. platform 502/504 HTML page) */
  }
  if (res.status === 429) return { code: "rate_limited", retryable: true };
  if (res.status === 504 || res.status === 408) return { code: "timeout_first_content", retryable: true };
  if (res.status === 401) return { code: "auth_required", retryable: false };
  if (res.status === 413) return { code: "input_too_long", retryable: false };
  if (res.status >= 500) return { code: "server_error", retryable: true };
  return { code: "bad_response", retryable: false };
}
