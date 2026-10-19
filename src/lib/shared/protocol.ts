/**
 * Wire protocol for /api/rephrase.
 * - Errors that happen before any text is generated → JSON body `{ error: ApiErrorBody }` with an HTTP error status.
 * - Success → `application/x-ndjson` stream of StreamEvent lines.
 */
import type { ErrorCode } from "./errors";

export type FinishKind = "complete" | "truncated" | "blocked" | "empty";

export type StreamEvent =
  | { type: "start"; requestId: string; model: string }
  | { type: "delta"; text: string }
  | { type: "done"; finish: FinishKind; reason?: string; usage?: { input?: number; output?: number } }
  | { type: "error"; error: ApiErrorBody };

export interface ApiErrorBody {
  code: ErrorCode;
  retryable: boolean;
  /** Seconds, when the provider or limiter specified it. */
  retryAfter?: number;
  requestId?: string;
}

export const NDJSON = "application/x-ndjson; charset=utf-8";

export function encodeEvent(e: StreamEvent): string {
  return JSON.stringify(e) + "\n";
}

/** Incremental NDJSON line parser; tolerant of chunk boundaries inside UTF-8 sequences (uses streaming TextDecoder). */
export class NdjsonParser {
  private buf = "";
  private decoder = new TextDecoder("utf-8");

  push(chunk: Uint8Array): StreamEvent[] {
    this.buf += this.decoder.decode(chunk, { stream: true });
    return this.drain(false);
  }

  end(): StreamEvent[] {
    this.buf += this.decoder.decode();
    return this.drain(true);
  }

  private drain(final: boolean): StreamEvent[] {
    const out: StreamEvent[] = [];
    let idx: number;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (line) out.push(parseLine(line));
    }
    if (final && this.buf.trim()) {
      out.push(parseLine(this.buf.trim()));
      this.buf = "";
    }
    return out;
  }
}

function parseLine(line: string): StreamEvent {
  try {
    const v = JSON.parse(line) as StreamEvent;
    if (v && typeof v === "object" && "type" in v) return v;
  } catch {
    /* fall through */
  }
  return { type: "error", error: { code: "bad_response", retryable: false } };
}
