import "server-only";
import { z } from "zod";
import { accessPolicy, getConfig } from "./env";
import { SESSION_COOKIE, clearSessionCookie, createSessionToken, passwordMatches, readCookie, sessionCookie, verifySessionToken } from "./auth";
import { clientKey, getLimiter } from "./rate-limit";
import { isSameOrigin, jsonResponse, readCappedText } from "./security";

const loginSchema = z.object({ password: z.string().min(1).max(256) }).strict();

function secure(req: Request): boolean {
  return new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
}

export async function sessionStatus(req: Request): Promise<Response> {
  const cfg = getConfig();
  const policy = accessPolicy(cfg);
  if (policy.kind === "misconfigured") return jsonResponse({ required: true, authenticated: false, configured: false }, 200);
  if (policy.kind === "open") return jsonResponse({ required: false, authenticated: true, configured: Boolean(cfg.apiKey) }, 200);
  const ok = Boolean(verifySessionToken(readCookie(req.headers.get("cookie"), SESSION_COOKIE), cfg.sessionSecret!));
  return jsonResponse({ required: true, authenticated: ok, configured: Boolean(cfg.apiKey) }, 200);
}

export async function login(req: Request): Promise<Response> {
  if (!isSameOrigin(req)) return jsonResponse({ error: { code: "forbidden_origin" } }, 403);
  const cfg = getConfig();
  const policy = accessPolicy(cfg);
  if (policy.kind !== "password") return jsonResponse({ error: { code: "not_configured" } }, policy.kind === "open" ? 400 : 503);
  const lim = getLimiter(cfg);
  if (lim.kind === "unconfigured") return jsonResponse({ error: { code: "rate_limit_unconfigured" } }, 503);
  if (lim.kind === "ready") {
    const r = await lim.limiter.limit("login", clientKey(req));
    if (!r.ok) return jsonResponse({ error: { code: "rate_limited", retryAfter: r.retryAfter } }, 429, { "Retry-After": String(r.retryAfter ?? 60) });
  }
  let body: z.infer<typeof loginSchema>;
  try {
    body = loginSchema.parse(JSON.parse(await readCappedText(req, 2048)));
  } catch {
    return jsonResponse({ error: { code: "invalid_request" } }, 400);
  }
  if (!passwordMatches(body.password, cfg.accessPassword!)) return jsonResponse({ error: { code: "auth_required" } }, 401);
  return jsonResponse({ ok: true }, 200, { "Set-Cookie": sessionCookie(createSessionToken(cfg.sessionSecret!), secure(req)) });
}

export async function logout(req: Request): Promise<Response> {
  if (!isSameOrigin(req)) return jsonResponse({ error: { code: "forbidden_origin" } }, 403);
  return jsonResponse({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(secure(req)) });
}
