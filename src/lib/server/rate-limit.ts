import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { ServerConfig } from "./env";

export interface LimitResult {
  ok: boolean;
  retryAfter?: number;
}

export interface Limiter {
  limit(bucket: "generate" | "login", key: string): Promise<LimitResult>;
}

export type LimiterState = { kind: "ready"; limiter: Limiter } | { kind: "disabled" } | { kind: "unconfigured" };

/** Dev/test only. Never used in production: serverless instances do not share memory. */
export class MemoryLimiter implements Limiter {
  private hits = new Map<string, number[]>();
  constructor(private perMinute: number, private now: () => number = Date.now) {}
  async limit(bucket: "generate" | "login", key: string): Promise<LimitResult> {
    const max = bucket === "login" ? 5 : this.perMinute;
    const k = `${bucket}:${key}`;
    const t = this.now();
    const list = (this.hits.get(k) ?? []).filter((x) => t - x < 60_000);
    if (list.length >= max) {
      this.hits.set(k, list);
      return { ok: false, retryAfter: Math.max(1, Math.ceil((60_000 - (t - list[0]!)) / 1000)) };
    }
    list.push(t);
    this.hits.set(k, list);
    return { ok: true };
  }
}

let cached: { sig: string; state: LimiterState } | undefined;

export function getLimiter(c: ServerConfig): LimiterState {
  const sig = [c.redisUrl, c.redisToken?.slice(-6), c.rateLimitPerMinute, c.rateLimitMode, c.isProduction].join("|");
  if (cached?.sig === sig) return cached.state;
  let state: LimiterState;
  if (c.rateLimitMode === "off") state = { kind: "disabled" };
  else if (c.redisUrl && c.redisToken) {
    const redis = new Redis({ url: c.redisUrl, token: c.redisToken });
    const gen = new Ratelimit({ redis, prefix: "sr:gen", limiter: Ratelimit.slidingWindow(c.rateLimitPerMinute, "60 s"), timeout: 1500, analytics: false });
    const login = new Ratelimit({ redis, prefix: "sr:login", limiter: Ratelimit.slidingWindow(5, "60 s"), timeout: 1500, analytics: false });
    state = {
      kind: "ready",
      limiter: {
        async limit(bucket, key) {
          const r = await (bucket === "login" ? login : gen).limit(key);
          return r.success ? { ok: true } : { ok: false, retryAfter: Math.max(1, Math.ceil((r.reset - Date.now()) / 1000)) };
        },
      },
    };
  } else if (!c.isProduction) state = { kind: "ready", limiter: new MemoryLimiter(c.rateLimitPerMinute) };
  else state = { kind: "unconfigured" };
  cached = { sig, state };
  return state;
}

export function clientKey(req: Request, sessionId?: string): string {
  if (sessionId) return `s:${sessionId}`;
  const h = req.headers;
  const ip = h.get("x-vercel-forwarded-for") ?? h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return `ip:${ip}`;
}
