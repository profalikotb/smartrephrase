import type { ErrorCode } from "@/lib/shared/errors";
import type { FinishKind } from "@/lib/shared/protocol";
import type { RewriteOptions, Variant } from "@/lib/shared/options";

export type Status = "idle" | "connecting" | "generating" | "retrying" | "completed" | "cancelled" | "offline" | "timed_out" | "error";

export const IN_FLIGHT: ReadonlySet<Status> = new Set<Status>(["connecting", "generating", "retrying"]);

export interface ResultRecord {
  opId: string;
  text: string;
  /** false = partial/incomplete; never presented as a finished rewrite. */
  complete: boolean;
  finish?: FinishKind;
  model?: string;
  variant: Variant;
  /** Exact input & settings that produced this result. */
  sourceText: string;
  options: RewriteOptions;
  fingerprint: string;
  createdAt: number;
}

export interface OpContext {
  opId: string;
  sourceText: string;
  options: RewriteOptions;
  variant: Variant;
  fingerprint: string;
  startedAt: number;
}

export interface RephraseState {
  status: Status;
  op?: OpContext;
  attempt: number;
  retryDelayMs?: number;
  retryCode?: ErrorCode;
  /** Streaming buffer for the active op. */
  live: string;
  errorCode?: ErrorCode;
  retryAfter?: number;
  /** Last completed result for single-version requests. */
  result?: ResultRecord;
  /** Last completed alternatives result. */
  alternatives?: ResultRecord;
  /** Incomplete text from a failed/cancelled op, clearly labelled in the UI. */
  partial?: ResultRecord;
}

export type Action =
  | { type: "start"; op: OpContext }
  | { type: "connecting"; opId: string; attempt: number }
  | { type: "retrying"; opId: string; attempt: number; delayMs: number; code: ErrorCode }
  | { type: "generating"; opId: string }
  | { type: "delta"; opId: string; text: string }
  | { type: "completed"; opId: string; finish: FinishKind; model?: string; at: number }
  | { type: "failed"; opId: string; code: ErrorCode; retryAfter?: number; at: number }
  | { type: "cancel"; opId: string; at: number }
  | { type: "discardPartial" }
  | { type: "replaceResult"; result: ResultRecord | undefined }
  | { type: "reset" };

export const initialState: RephraseState = { status: "idle", attempt: 0, live: "" };

function statusFor(code: ErrorCode): Status {
  if (code === "offline") return "offline";
  if (code === "cancelled") return "cancelled";
  if (code.startsWith("timeout_")) return "timed_out";
  return "error";
}

function record(s: RephraseState, op: OpContext, complete: boolean, at: number, finish?: FinishKind, model?: string): ResultRecord {
  return { opId: op.opId, text: s.live, complete, finish, model, variant: op.variant, sourceText: op.sourceText, options: op.options, fingerprint: op.fingerprint, createdAt: at };
}

/**
 * Every op-scoped action carries its opId; actions from any op other than the current one are ignored.
 * This is what prevents cancelled, superseded or late responses from touching the UI.
 */
export function reducer(s: RephraseState, a: Action): RephraseState {
  if ("opId" in a && (!s.op || s.op.opId !== a.opId)) return s;
  switch (a.type) {
    case "start":
      return { ...s, status: "connecting", op: a.op, attempt: 0, live: "", errorCode: undefined, retryAfter: undefined, retryDelayMs: undefined, retryCode: undefined };
    case "connecting":
      if (!isActive(s)) return s;
      return { ...s, status: "connecting", attempt: a.attempt, retryDelayMs: undefined, live: "" };
    case "retrying":
      if (!isActive(s)) return s;
      return { ...s, status: "retrying", attempt: a.attempt, retryDelayMs: a.delayMs, retryCode: a.code, live: "" };
    case "generating":
      if (!isActive(s)) return s;
      return { ...s, status: "generating" };
    case "delta":
      if (!isActive(s)) return s;
      return { ...s, status: "generating", live: s.live + a.text };
    case "completed": {
      if (!isActive(s) || !s.op) return s;
      const complete = a.finish === "complete";
      const rec = record(s, s.op, complete, a.at, a.finish, a.model);
      if (!complete) return { ...s, status: "completed", partial: rec, live: "" };
      return s.op.variant === "alternatives"
        ? { ...s, status: "completed", alternatives: rec, partial: undefined, live: "" }
        : { ...s, status: "completed", result: rec, partial: undefined, live: "" };
    }
    case "failed": {
      if (!isActive(s) || !s.op) return s;
      const partial = s.live.trim() ? record(s, s.op, false, a.at) : s.partial;
      return { ...s, status: statusFor(a.code), errorCode: a.code, retryAfter: a.retryAfter, partial, live: "" };
    }
    case "cancel": {
      if (!isActive(s) || !s.op) return s;
      const partial = s.live.trim() ? record(s, s.op, false, a.at) : s.partial;
      return { ...s, status: "cancelled", errorCode: "cancelled", partial, live: "" };
    }
    case "discardPartial":
      return { ...s, partial: undefined };
    case "replaceResult":
      return { ...s, result: a.result, partial: undefined, alternatives: undefined };
    case "reset":
      return { ...initialState };
  }
}

function isActive(s: RephraseState): boolean {
  return IN_FLIGHT.has(s.status);
}
