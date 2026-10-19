import "server-only";

export type ThinkingLevelName = "minimal" | "low" | "medium" | "high";

export interface ServerConfig {
  apiKey: string | undefined;
  model: string;
  fallbackModel: string | undefined;
  thinkingLevel: ThinkingLevelName | undefined;
  temperature: number | undefined;
  accessPassword: string | undefined;
  sessionSecret: string | undefined;
  publicAccess: boolean;
  isProduction: boolean;
  redisUrl: string | undefined;
  redisToken: string | undefined;
  rateLimitPerMinute: number;
  rateLimitMode: "on" | "off";
  /** Optional API base URL override (corporate proxy / local mock for end-to-end tests). */
  baseUrl: string | undefined;
}

/** Verified against ai.google.dev/gemini-api/docs/models on 2026-10-19 (stable, no shutdown date announced). */
export const DEFAULT_MODEL = "gemini-3.5-flash-lite";
export const MODEL_VERIFIED_ON = "2026-10-19";

const MODEL_ID = /^[a-z0-9][a-z0-9.\-]{2,80}$/;

function clean(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

/** Read on every call so configuration changes and tests never see stale values. */
export function getConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const model = clean(env.GEMINI_MODEL) ?? DEFAULT_MODEL;
  const fallback = clean(env.GEMINI_FALLBACK_MODEL);
  const tl = clean(env.GEMINI_THINKING_LEVEL)?.toLowerCase();
  const temp = clean(env.GEMINI_TEMPERATURE);
  const rpm = Number.parseInt(clean(env.RATE_LIMIT_PER_MINUTE) ?? "20", 10);
  return {
    apiKey: clean(env.GEMINI_API_KEY),
    model: MODEL_ID.test(model) ? model : DEFAULT_MODEL,
    fallbackModel: fallback && MODEL_ID.test(fallback) && fallback !== model ? fallback : undefined,
    thinkingLevel: tl === "minimal" || tl === "low" || tl === "medium" || tl === "high" ? tl : tl === "default" ? undefined : "minimal",
    temperature: temp !== undefined && Number.isFinite(Number(temp)) ? Math.min(2, Math.max(0, Number(temp))) : undefined,
    accessPassword: clean(env.ACCESS_PASSWORD),
    sessionSecret: clean(env.SESSION_SECRET),
    publicAccess: clean(env.PUBLIC_ACCESS)?.toLowerCase() === "true",
    isProduction: env.NODE_ENV === "production",
    redisUrl: clean(env.UPSTASH_REDIS_REST_URL) ?? clean(env.KV_REST_API_URL),
    redisToken: clean(env.UPSTASH_REDIS_REST_TOKEN) ?? clean(env.KV_REST_API_TOKEN),
    rateLimitPerMinute: Number.isFinite(rpm) && rpm > 0 ? Math.min(rpm, 600) : 20,
    rateLimitMode: clean(env.RATE_LIMIT_MODE)?.toLowerCase() === "off" ? "off" : "on",
    baseUrl: /^https?:\/\/[^\s]+$/.test(clean(env.GEMINI_BASE_URL) ?? "") ? clean(env.GEMINI_BASE_URL) : undefined,
  };
}

export type AccessPolicy = { kind: "open" } | { kind: "password" } | { kind: "misconfigured"; reason: string };

export function accessPolicy(c: ServerConfig): AccessPolicy {
  if (c.accessPassword) {
    if (!c.sessionSecret || c.sessionSecret.length < 32) return { kind: "misconfigured", reason: "SESSION_SECRET must be at least 32 characters when ACCESS_PASSWORD is set" };
    return { kind: "password" };
  }
  if (c.isProduction && !c.publicAccess) return { kind: "misconfigured", reason: "Set ACCESS_PASSWORD (recommended) or PUBLIC_ACCESS=true" };
  return { kind: "open" };
}
