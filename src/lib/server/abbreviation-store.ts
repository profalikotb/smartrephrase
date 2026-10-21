import "server-only";
import type { Redis } from "@upstash/redis";
import { ABBR_LIMITS, DEFAULT_ABBREVIATIONS, sortAbbreviations, type Abbreviation } from "@/lib/shared/abbreviations";

export interface AbbrStore {
  kind: "redis" | "memory";
  list(): Promise<Abbreviation[]>;
  upsert(a: Abbreviation, previousKey?: string): Promise<void>;
  remove(key: string): Promise<void>;
  importMany(list: Abbreviation[], overwrite: boolean): Promise<number>;
  restoreDefaults(): Promise<number>;
  count(): Promise<number>;
}

const HASH = "sr:abbr:v1";
const SEEDED = "sr:abbr:v1:seeded";

/** Redis hash: one field per abbreviation → atomic per-entry edits, so phone and desktop never overwrite each other's lists. */
export class RedisAbbrStore implements AbbrStore {
  kind = "redis" as const;
  constructor(private redis: Redis) {}

  private async seed(): Promise<void> {
    // Seed exactly once per store, even if the user later deletes everything.
    const first = await this.redis.set(SEEDED, "1", { nx: true });
    if (first === "OK") await this.redis.hset(HASH, Object.fromEntries(DEFAULT_ABBREVIATIONS.map((a) => [a.key, a.text])));
  }
  async list(): Promise<Abbreviation[]> {
    await this.seed();
    const all = (await this.redis.hgetall<Record<string, unknown>>(HASH)) ?? {};
    return sortAbbreviations(Object.entries(all).map(([key, text]) => ({ key, text: String(text) })));
  }
  async count(): Promise<number> {
    return this.redis.hlen(HASH);
  }
  async upsert(a: Abbreviation, previousKey?: string): Promise<void> {
    await this.seed();
    await this.redis.hset(HASH, { [a.key]: a.text });
    if (previousKey && previousKey !== a.key) await this.redis.hdel(HASH, previousKey);
  }
  async remove(key: string): Promise<void> {
    await this.seed();
    await this.redis.hdel(HASH, key);
  }
  async importMany(list: Abbreviation[], overwrite: boolean): Promise<number> {
    await this.seed();
    let entries = list;
    if (!overwrite) {
      const existing = new Set(Object.keys((await this.redis.hgetall<Record<string, unknown>>(HASH)) ?? {}));
      entries = list.filter((a) => !existing.has(a.key));
    }
    if (entries.length) await this.redis.hset(HASH, Object.fromEntries(entries.map((a) => [a.key, a.text])));
    return entries.length;
  }
  async restoreDefaults(): Promise<number> {
    return this.importMany(DEFAULT_ABBREVIATIONS, false);
  }
}

/** Development only (no Redis): lives as long as the server process. */
export class MemoryAbbrStore implements AbbrStore {
  kind = "memory" as const;
  private map = new Map(DEFAULT_ABBREVIATIONS.map((a) => [a.key, a.text]));
  async list() {
    return sortAbbreviations([...this.map].map(([key, text]) => ({ key, text })));
  }
  async count() {
    return this.map.size;
  }
  async upsert(a: Abbreviation, previousKey?: string) {
    this.map.set(a.key, a.text);
    if (previousKey && previousKey !== a.key) this.map.delete(previousKey);
  }
  async remove(key: string) {
    this.map.delete(key);
  }
  async importMany(list: Abbreviation[], overwrite: boolean) {
    let n = 0;
    for (const a of list)
      if (overwrite || !this.map.has(a.key)) {
        this.map.set(a.key, a.text);
        n++;
      }
    return n;
  }
  async restoreDefaults() {
    return this.importMany(DEFAULT_ABBREVIATIONS, false);
  }
}

export const MAX_ENTRIES = ABBR_LIMITS.maxEntries;
