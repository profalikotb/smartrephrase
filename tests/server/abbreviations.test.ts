import { describe, expect, it } from "vitest";
import type { Redis } from "@upstash/redis";
import { createAbbreviationHandlers } from "@/lib/server/abbreviations-handler";
import { MemoryAbbrStore, RedisAbbrStore } from "@/lib/server/abbreviation-store";
import { getConfig } from "@/lib/server/env";
import { MemoryLimiter } from "@/lib/server/rate-limit";
import { createSessionToken } from "@/lib/server/auth";

const SECRET = "z".repeat(40);
const env = (o: Record<string, string>) => getConfig(o as unknown as NodeJS.ProcessEnv);

function setup(cfgEnv: Record<string, string> = { NODE_ENV: "test" }, noStore = false) {
  const store = noStore ? undefined : new MemoryAbbrStore();
  const cfg = env(cfgEnv);
  return createAbbreviationHandlers({ getConfig: () => cfg, getLimiter: () => ({ kind: "ready", limiter: new MemoryLimiter(100) }), getStore: () => store });
}
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://app.test/api/abbreviations", { method: "POST", headers: { "content-type": "application/json", origin: "https://app.test", "sec-fetch-site": "same-origin", ...headers }, body: JSON.stringify(body) });
const get = (headers: Record<string, string> = {}) => new Request("https://app.test/api/abbreviations", { headers });

describe("/api/abbreviations", () => {
  it("lists defaults, upserts (normalising key), renames and deletes", async () => {
    const h = setup();
    const list = await (await h.GET(get())).json();
    expect(list.entries).toHaveLength(69);
    let r = await (await h.POST(post({ op: "upsert", key: "dxy", text: "  DR   X  Y " }))).json();
    expect(r.entries.find((e: { key: string }) => e.key === "DXY").text).toBe("DR X Y");
    r = await (await h.POST(post({ op: "upsert", key: "DXZ", text: "DR X Z", previousKey: "DXY" }))).json();
    expect(r.entries.some((e: { key: string }) => e.key === "DXY")).toBe(false);
    r = await (await h.POST(post({ op: "delete", key: "dxz" }))).json();
    expect(r.entries).toHaveLength(69);
  });
  it("import respects overwrite flag; restore_defaults re-adds deleted defaults", async () => {
    const h = setup();
    await h.POST(post({ op: "import", entries: [{ key: "PT", text: "CHANGED" }, { key: "NEW1", text: "NEW ONE" }], overwrite: false }));
    let r = await (await h.GET(get())).json();
    expect(r.entries.find((e: { key: string }) => e.key === "PT").text).toBe("PATIENT");
    expect(r.entries).toHaveLength(70);
    await h.POST(post({ op: "delete", key: "PT" }));
    r = await (await h.POST(post({ op: "restore_defaults" }))).json();
    expect(r.entries.find((e: { key: string }) => e.key === "PT").text).toBe("PATIENT");
  });
  it("rejects invalid keys/text, cross-origin writes and unknown ops", async () => {
    const h = setup();
    expect((await h.POST(post({ op: "upsert", key: "BAD KEY", text: "x" }))).status).toBe(400);
    expect((await h.POST(post({ op: "upsert", key: "OK", text: "   " }))).status).toBe(400);
    expect((await h.POST(post({ op: "upsert", key: "OK", text: "x".repeat(501) }))).status).toBe(400);
    expect((await h.POST(post({ op: "drop_all" }))).status).toBe(400);
    expect((await h.POST(post({ op: "delete", key: "PT" }, { origin: "https://evil.test", "sec-fetch-site": "cross-site" }))).status).toBe(403);
  });
  it("requires the session cookie when a password is set (reads and writes)", async () => {
    const h = setup({ NODE_ENV: "production", ACCESS_PASSWORD: "pw", SESSION_SECRET: SECRET });
    expect((await h.GET(get())).status).toBe(401);
    expect((await h.POST(post({ op: "delete", key: "PT" }))).status).toBe(401);
    const cookie = `sr_session=${createSessionToken(SECRET)}`;
    expect((await h.GET(get({ cookie }))).status).toBe(200);
  });
  it("production without Redis → device storage signal; writes refused", async () => {
    const h = setup({ NODE_ENV: "production", PUBLIC_ACCESS: "true" }, true);
    expect(await (await h.GET(get())).json()).toEqual({ storage: "device", entries: [] });
    expect((await h.POST(post({ op: "delete", key: "PT" }))).status).toBe(503);
  });
});

describe("Redis store", () => {
  function fakeRedis() {
    const kv = new Map<string, string>();
    const hash = new Map<string, Map<string, string>>();
    const h = (k: string) => hash.get(k) ?? (hash.set(k, new Map()), hash.get(k)!);
    return {
      async set(k: string, v: string, o?: { nx?: boolean }) {
        if (o?.nx && kv.has(k)) return null;
        kv.set(k, v);
        return "OK";
      },
      async hset(k: string, obj: Record<string, string>) {
        for (const [f, v] of Object.entries(obj)) h(k).set(f, v);
        return Object.keys(obj).length;
      },
      async hgetall(k: string) {
        const m = hash.get(k);
        return m && m.size ? Object.fromEntries(m) : null;
      },
      async hdel(k: string, f: string) {
        return h(k).delete(f) ? 1 : 0;
      },
      async hlen(k: string) {
        return h(k).size;
      },
    } as unknown as Redis;
  }
  it("seeds once; deleting everything does not resurrect defaults", async () => {
    const s = new RedisAbbrStore(fakeRedis());
    const all = await s.list();
    expect(all).toHaveLength(69);
    for (const a of all) await s.remove(a.key);
    expect(await s.list()).toHaveLength(0);
    await s.upsert({ key: "X1", text: "ONE" });
    expect(await s.list()).toEqual([{ key: "X1", text: "ONE" }]);
  });
});
