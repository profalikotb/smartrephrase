export const ERROR_CODES = [
  "offline",
  "network",
  "timeout_first_content",
  "timeout_inactivity",
  "timeout_overall",
  "rate_limited",
  "quota_exhausted",
  "auth_provider",
  "auth_required",
  "forbidden_origin",
  "invalid_request",
  "input_too_long",
  "model_unavailable",
  "server_error",
  "provider_overloaded",
  "blocked",
  "empty",
  "bad_response",
  "not_configured",
  "rate_limit_unconfigured",
  "interrupted",
  "cancelled",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Codes the client may retry automatically, *only* before any text has streamed. */
export const AUTO_RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "network",
  "timeout_first_content",
  "rate_limited",
  "server_error",
  "provider_overloaded",
  "model_unavailable",
]);

/** Codes for which a manual "Retry" makes sense. */
export const MANUALLY_RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  ...AUTO_RETRYABLE,
  "offline",
  "timeout_inactivity",
  "timeout_overall",
  "interrupted",
  "empty",
  "bad_response",
  "cancelled",
]);

export function isErrorCode(v: unknown): v is ErrorCode {
  return typeof v === "string" && (ERROR_CODES as readonly string[]).includes(v);
}
