import "server-only";
import { ApiError } from "@google/genai";
import type { ErrorCode } from "@/lib/shared/errors";

export interface MappedError {
  code: ErrorCode;
  status: number;
  retryAfter?: number;
}

interface GoogleErrorBody {
  error?: {
    code?: number;
    status?: string;
    message?: string;
    details?: Array<{
      "@type"?: string;
      retryDelay?: string;
      reason?: string;
      violations?: Array<{ quotaId?: string; quotaMetric?: string; quotaValue?: string }>;
    }>;
  };
}

function parseBody(message: string): GoogleErrorBody | undefined {
  try {
    const v = JSON.parse(message) as unknown;
    return v && typeof v === "object" ? (v as GoogleErrorBody) : undefined;
  } catch {
    return undefined;
  }
}

function parseDelay(d: string | undefined): number | undefined {
  if (!d) return undefined;
  const m = /^([\d.]+)s$/.exec(d.trim());
  if (!m) return undefined;
  const s = Math.ceil(Number(m[1]));
  return Number.isFinite(s) && s >= 0 ? Math.min(s, 3600) : undefined;
}

/** Translate provider failures into user-safe codes. Raw provider messages never leave the server. */
export function mapProviderError(err: unknown): MappedError {
  if (err instanceof ApiError || (err && typeof err === "object" && "status" in err && typeof (err as { status: unknown }).status === "number" && err instanceof Error)) {
    const status = (err as ApiError).status;
    const body = parseBody((err as Error).message);
    const details = body?.error?.details ?? [];
    const gStatus = body?.error?.status ?? "";
    const msg = (body?.error?.message ?? (err as Error).message ?? "").toLowerCase();
    const retryAfter = parseDelay(details.find((d) => d["@type"]?.includes("RetryInfo"))?.retryDelay);
    const reasons = details.map((d) => d.reason ?? "").join(" ");

    if (status === 429 || gStatus === "RESOURCE_EXHAUSTED") {
      const quotaIds = details.flatMap((d) => d.violations ?? []).map((v) => `${v.quotaId ?? ""} ${v.quotaMetric ?? ""} ${v.quotaValue ?? ""}`);
      const daily = quotaIds.some((q) => /perday|per_day|daily/i.test(q));
      const zero = details.flatMap((d) => d.violations ?? []).some((v) => v.quotaValue === "0");
      const billing = /billing|prepay|credits? (?:are )?depleted|spending cap/.test(msg);
      if (daily || zero || billing) return { code: "quota_exhausted", status: 429, retryAfter };
      return { code: "rate_limited", status: 429, retryAfter: retryAfter ?? 5 };
    }
    if (status === 401 || status === 403 || /API_KEY_INVALID|API_KEY_SERVICE_BLOCKED|PERMISSION_DENIED/.test(reasons) || /api key not valid|api key expired|permission/.test(msg)) {
      return { code: "auth_provider", status: 502 };
    }
    if (gStatus === "FAILED_PRECONDITION" && /location|region|country/.test(msg)) return { code: "auth_provider", status: 502 };
    if (status === 404) return { code: "model_unavailable", status: 502 };
    if (status === 400) return { code: "invalid_request", status: 400 };
    if (status === 503) return { code: "provider_overloaded", status: 503, retryAfter };
    if (status === 408 || status === 504) return { code: "server_error", status: 504 };
    if (status >= 500) return { code: "server_error", status: 502 };
    return { code: "server_error", status: 502 };
  }
  return { code: "network", status: 502 };
}
