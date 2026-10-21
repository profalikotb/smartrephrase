import "server-only";
import { randomUUID } from "node:crypto";
import { abbrOpSchema, abbreviationSchema, ABBR_KEY_RE, type Abbreviation } from "@/lib/shared/abbreviations";
import { accessPolicy, getConfig as defaultGetConfig, type ServerConfig } from "./env";
import { SESSION_COOKIE, readCookie, verifySessionToken } from "./auth";
import { clientKey, getLimiter as defaultGetLimiter, getRedis, type LimiterState } from "./rate-limit";
import { MAX_ENTRIES, MemoryAbbrStore, RedisAbbrStore, type AbbrStore } from "./abbreviation-store";
import { isSameOrigin, jsonResponse, readCappedText } from "./security";

export interface AbbrDeps {
  getConfig: () => ServerConfig;
  getLimiter: (c: ServerConfig) => LimiterState;
  getStore: (c: ServerConfig) => AbbrStore | undefined;
}

let devStore: MemoryAbbrStore | undefined;

export const defaultAbbrDeps: AbbrDeps = {
  getConfig: () => defaultGetConfig(),
  getLimiter: defaultGetLimiter,
  getStore: (c) => {
    const redis = getRedis(c);
    if (redis) return new RedisAbbrStore(redis);
    if (!c.isProduction) return (devStore ??= new MemoryAbbrStore());
    return undefined; // production without Redis → client keeps its list on the device
  },
};

const fail = (code: string, status: number) => jsonResponse({ error: { code } }, status, { "X-Request-Id": randomUUID() });

async function authorize(req: Request, deps: AbbrDeps, write: boolean): Promise<{ cfg: ServerConfig; key: string } | Response> {
  if (write && !isSameOrigin(req)) return fail("forbidden_origin", 403);
  const cfg = deps.getConfig();
  const policy = accessPolicy(cfg);
  if (policy.kind === "misconfigured") return fail("not_configured", 503);
  let sid: string | undefined;
  if (policy.kind === "password") {
    const s = verifySessionToken(readCookie(req.headers.get("cookie"), SESSION_COOKIE), cfg.sessionSecret!);
    if (!s) return fail("auth_required", 401);
    sid = s.sid;
  }
  const lim = deps.getLimiter(cfg);
  if (lim.kind === "ready") {
    const r = await lim.limiter.limit("abbr", clientKey(req, sid));
    if (!r.ok) return jsonResponse({ error: { code: "rate_limited", retryAfter: r.retryAfter } }, 429, { "Retry-After": String(r.retryAfter ?? 30) });
  }
  return { cfg, key: sid ?? "" };
}

export function createAbbreviationHandlers(deps: AbbrDeps = defaultAbbrDeps) {
  async function GET(req: Request): Promise<Response> {
    const a = await authorize(req, deps, false);
    if (a instanceof Response) return a;
    const store = deps.getStore(a.cfg);
    if (!store) return jsonResponse({ storage: "device", entries: [] }, 200);
    try {
      return jsonResponse({ storage: store.kind === "redis" ? "cloud" : "server-memory", entries: await store.list() }, 200);
    } catch {
      return fail("storage_error", 502);
    }
  }

  async function POST(req: Request): Promise<Response> {
    const a = await authorize(req, deps, true);
    if (a instanceof Response) return a;
    if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return fail("invalid_request", 415);
    const store = deps.getStore(a.cfg);
    if (!store) return fail("storage_unavailable", 503);

    let op;
    try {
      op = abbrOpSchema.parse(JSON.parse(await readCappedText(req, 512 * 1024)));
    } catch {
      return fail("invalid_request", 400);
    }
    try {
      switch (op.op) {
        case "upsert": {
          const e = abbreviationSchema.safeParse({ key: op.key, text: op.text });
          if (!e.success) return fail("invalid_entry", 400);
          const prev = op.previousKey && ABBR_KEY_RE.test(op.previousKey) ? op.previousKey.toUpperCase() : undefined;
          if (!prev || prev !== e.data.key) {
            if ((await store.count()) >= MAX_ENTRIES) return fail("too_many", 400);
          }
          await store.upsert(e.data, prev);
          break;
        }
        case "delete":
          if (!ABBR_KEY_RE.test(op.key)) return fail("invalid_entry", 400);
          await store.remove(op.key.toUpperCase());
          break;
        case "import": {
          const valid: Abbreviation[] = [];
          for (const raw of op.entries) {
            const e = abbreviationSchema.safeParse(raw);
            if (e.success) valid.push(e.data);
          }
          if ((await store.count()) + valid.length > MAX_ENTRIES) return fail("too_many", 400);
          await store.importMany(valid, op.overwrite);
          break;
        }
        case "restore_defaults":
          await store.restoreDefaults();
          break;
      }
      return jsonResponse({ storage: store.kind === "redis" ? "cloud" : "server-memory", entries: await store.list() }, 200);
    } catch {
      return fail("storage_error", 502);
    }
  }

  return { GET, POST };
}
