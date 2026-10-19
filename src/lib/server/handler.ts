import "server-only";
import { randomUUID } from "node:crypto";
import { LIMITS, charLength, requestSchema } from "@/lib/shared/options";
import type { ErrorCode } from "@/lib/shared/errors";
import { AUTO_RETRYABLE } from "@/lib/shared/errors";
import { NDJSON, encodeEvent, type ApiErrorBody, type FinishKind } from "@/lib/shared/protocol";
import { TIMEOUTS } from "@/lib/shared/timeouts";
import { GuardTimeout, guardStream } from "@/lib/shared/stream-guard";
import { accessPolicy, getConfig as defaultGetConfig, type ServerConfig } from "./env";
import { SESSION_COOKIE, readCookie, verifySessionToken } from "./auth";
import { clientKey, getLimiter as defaultGetLimiter, type LimiterState } from "./rate-limit";
import { BodyTooLarge, NO_STORE_HEADERS, isSameOrigin, jsonResponse, readCappedText } from "./security";
import { buildPrompt } from "./prompt";
import { geminiProvider, type Provider, type ProviderChunk } from "./gemini";
import { mapProviderError } from "./provider-errors";

export interface HandlerDeps {
  provider: Provider;
  getConfig: () => ServerConfig;
  getLimiter: (c: ServerConfig) => LimiterState;
  now: () => number;
  /** Metadata only — never source or generated text. */
  log: (entry: Record<string, string | number | boolean | undefined>) => void;
  timeouts: { firstContentMs: number; inactivityMs: number; overallMs: number };
}

const BLOCK_FINISH = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY", "LANGUAGE"]);

export const defaultDeps: HandlerDeps = {
  provider: geminiProvider,
  getConfig: () => defaultGetConfig(),
  getLimiter: defaultGetLimiter,
  now: Date.now,
  log: (e) => console.info(JSON.stringify({ svc: "rephrase", ...e })),
  timeouts: { firstContentMs: TIMEOUTS.firstContentMs, inactivityMs: TIMEOUTS.inactivityMs, overallMs: TIMEOUTS.overallMs },
};

function errorBody(code: ErrorCode, requestId: string, retryAfter?: number): { error: ApiErrorBody } {
  return { error: { code, retryable: AUTO_RETRYABLE.has(code), retryAfter, requestId } };
}

function fail(code: ErrorCode, status: number, requestId: string, retryAfter?: number): Response {
  const headers: Record<string, string> = { "X-Request-Id": requestId };
  if (retryAfter !== undefined) headers["Retry-After"] = String(retryAfter);
  return jsonResponse(errorBody(code, requestId, retryAfter), status, headers);
}

function classify(chunk: ProviderChunk): FinishKind | undefined {
  if (chunk.blockReason) return "blocked";
  const f = chunk.finishReason;
  if (!f || f === "FINISH_REASON_UNSPECIFIED") return undefined;
  if (f === "STOP") return "complete";
  if (BLOCK_FINISH.has(f)) return "blocked";
  return "truncated"; // MAX_TOKENS, OTHER, MALFORMED_*, …: never presented as a complete rewrite
}

export function createRephraseHandler(deps: HandlerDeps = defaultDeps) {
  return async function POST(req: Request): Promise<Response> {
    const requestId = randomUUID();
    const t0 = deps.now();
    const cfg = deps.getConfig();

    if (!isSameOrigin(req)) return fail("forbidden_origin", 403, requestId);
    if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return fail("invalid_request", 415, requestId);

    // --- Access control (server-verified) ---
    const policy = accessPolicy(cfg);
    if (policy.kind === "misconfigured") {
      deps.log({ requestId, event: "misconfigured", reason: policy.reason });
      return fail("not_configured", 503, requestId);
    }
    let sessionId: string | undefined;
    if (policy.kind === "password") {
      const s = verifySessionToken(readCookie(req.headers.get("cookie"), SESSION_COOKIE), cfg.sessionSecret!);
      if (!s) return fail("auth_required", 401, requestId);
      sessionId = s.sid;
    }

    // --- Rate limiting (shared storage in production) ---
    const lim = deps.getLimiter(cfg);
    if (lim.kind === "unconfigured") {
      deps.log({ requestId, event: "rate_limit_unconfigured" });
      return fail("rate_limit_unconfigured", 503, requestId);
    }
    if (lim.kind === "ready") {
      const r = await lim.limiter.limit("generate", clientKey(req, sessionId));
      if (!r.ok) return fail("rate_limited", 429, requestId, r.retryAfter);
    }

    // --- Validation ---
    let raw: string;
    try {
      raw = await readCappedText(req);
    } catch (e) {
      return fail(e instanceof BodyTooLarge ? "input_too_long" : "invalid_request", e instanceof BodyTooLarge ? 413 : 400, requestId);
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return fail("invalid_request", 400, requestId);
    }
    const parsed = requestSchema.safeParse(json);
    if (!parsed.success) return fail("invalid_request", 400, requestId);
    const body = parsed.data;
    if (!body.text.trim()) return fail("invalid_request", 400, requestId);
    if (charLength(body.text) > LIMITS.maxInputChars) return fail("input_too_long", 413, requestId);

    if (!cfg.apiKey) {
      deps.log({ requestId, event: "missing_api_key" });
      return fail("not_configured", 503, requestId);
    }

    // --- Upstream call with real cancellation ---
    const model = body.useFallback && cfg.fallbackModel ? cfg.fallbackModel : cfg.model;
    const controller = new AbortController();
    const onClientAbort = () => controller.abort(new DOMException("client disconnected", "AbortError"));
    if (req.signal.aborted) onClientAbort();
    req.signal.addEventListener("abort", onClientAbort, { once: true });
    const cleanup = () => req.signal.removeEventListener("abort", onClientAbort);

    const deadlineAt = t0 + Math.min(deps.timeouts.overallMs, body.budgetMs);
    const prompt = buildPrompt(body.text, body.options, body.variant, body.uiLang);
    const meta = { requestId, model, mode: body.options.mode, style: body.options.style, variant: body.variant, attempt: body.attempt, inChars: charLength(body.text) };

    const toCode = (e: unknown): { code: ErrorCode; status: number; retryAfter?: number } => {
      if (e instanceof GuardTimeout) return { code: e.kind === "first_content" ? "timeout_first_content" : e.kind === "inactivity" ? "timeout_inactivity" : "timeout_overall", status: 504 };
      if (controller.signal.aborted && !(controller.signal.reason instanceof GuardTimeout)) return { code: "cancelled", status: 499 };
      return mapProviderError(e);
    };

    let iterator: AsyncGenerator<ProviderChunk>;
    let first: IteratorResult<ProviderChunk>;
    try {
      const source = await raceDeadline(deps.provider({ apiKey: cfg.apiKey, model, prompt, signal: controller.signal, thinkingLevel: cfg.thinkingLevel, temperature: cfg.temperature, baseUrl: cfg.baseUrl }), controller, deadlineAt, deps.now, deps.timeouts.firstContentMs);
      iterator = guardStream(source, {
        controller,
        firstContentMs: deps.timeouts.firstContentMs,
        inactivityMs: deps.timeouts.inactivityMs,
        deadlineAt,
        hasContent: (c) => c.text.length > 0,
        now: deps.now,
      });
      // Wait for the first meaningful chunk (text or a terminal signal) so pre-output failures get a proper HTTP status.
      do {
        first = await iterator.next();
      } while (!first.done && first.value.text.length === 0 && classify(first.value) === undefined);
    } catch (e) {
      cleanup();
      const m = toCode(e);
      deps.log({ ...meta, event: "error_before_output", code: m.code, ms: deps.now() - t0 });
      return fail(m.code, m.status, requestId, m.retryAfter);
    }

    if (first.done || (first.value.text.length === 0 && classify(first.value) === "blocked")) {
      cleanup();
      const blocked = !first.done && classify(first.value) === "blocked";
      deps.log({ ...meta, event: blocked ? "blocked" : "empty", ms: deps.now() - t0 });
      return fail(blocked ? "blocked" : "empty", 422, requestId);
    }
    if (first.value.text.length === 0) {
      // Terminal chunk with no text at all (e.g. MAX_TOKENS consumed by reasoning) → empty.
      cleanup();
      deps.log({ ...meta, event: "empty", finish: first.value.finishReason, ms: deps.now() - t0 });
      return fail("empty", 422, requestId);
    }

    const firstChunk = first.value;
    const firstMs = deps.now() - t0;
    const enc = new TextEncoder();
    let closed = false;

    const stream = new ReadableStream<Uint8Array>({
      async start(ctrl) {
        const send = (s: string) => {
          if (!closed) ctrl.enqueue(enc.encode(s));
        };
        let outChars = 0;
        let finish: FinishKind | undefined;
        let reason: string | undefined;
        let usage: ProviderChunk["usage"];
        try {
          send(encodeEvent({ type: "start", requestId, model }));
          const handle = (c: ProviderChunk) => {
            if (c.text) {
              outChars += c.text.length;
              send(encodeEvent({ type: "delta", text: c.text }));
            }
            if (c.usage) usage = c.usage;
            const k = classify(c);
            if (k) {
              finish = k;
              reason = c.blockReason ?? c.finishReason;
            }
          };
          handle(firstChunk);
          while (!finish) {
            const n = await iterator.next();
            if (n.done) break;
            handle(n.value);
          }
          // Stream closed without a finish reason → incomplete, never "complete".
          send(encodeEvent({ type: "done", finish: finish ?? "truncated", reason: finish ? reason : "NO_FINISH_REASON", usage }));
          deps.log({ ...meta, event: "done", finish: finish ?? "truncated", firstMs, ms: deps.now() - t0, outChars });
        } catch (e) {
          const m = toCode(e);
          send(encodeEvent({ type: "error", error: { code: m.code, retryable: false, requestId } }));
          deps.log({ ...meta, event: "error_mid_stream", code: m.code, firstMs, ms: deps.now() - t0, outChars });
        } finally {
          cleanup();
          void iterator.return(undefined).catch(() => undefined);
          if (!closed) {
            closed = true;
            try {
              ctrl.close();
            } catch {
              /* already closed */
            }
          }
        }
      },
      cancel() {
        // Browser went away (tab closed, navigation, fetch aborted) → stop the upstream request.
        closed = true;
        controller.abort(new DOMException("client disconnected", "AbortError"));
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": NDJSON, "X-Request-Id": requestId, "X-Accel-Buffering": "no", ...NO_STORE_HEADERS },
    });
  };
}

/** Bounds the *connection* phase (before the SDK yields an iterator) by the same first-content/overall clocks. */
async function raceDeadline<T>(p: Promise<T>, controller: AbortController, deadlineAt: number, now: () => number, firstContentMs: number): Promise<T> {
  const remaining = deadlineAt - now();
  const ms = Math.max(0, Math.min(remaining, firstContentMs));
  const kind = remaining <= firstContentMs ? "overall" : "first_content";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => {
        const t = new GuardTimeout(kind);
        controller.abort(t);
        reject(t);
      }, ms);
      onAbort = () => reject(controller.signal.reason ?? new DOMException("Aborted", "AbortError"));
      controller.signal.addEventListener("abort", onAbort, { once: true });
      p.then(resolve, reject);
    });
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) controller.signal.removeEventListener("abort", onAbort);
  }
}
