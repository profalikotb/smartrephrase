import { describe, expect, it } from "vitest";
import { geminiProvider } from "@/lib/server/gemini";
import { buildPrompt } from "@/lib/server/prompt";
import { DEFAULT_OPTIONS } from "@/lib/shared/options";
import { mockGeminiFetch, textChunk, type MockCall } from "../helpers/mock-gemini";
import { ApiError } from "@google/genai";
import { mapProviderError } from "@/lib/server/provider-errors";

const prompt = buildPrompt("نص تجريبي", DEFAULT_OPTIONS, "single", "ar");

async function collect(it: AsyncIterable<{ text: string; finishReason?: string }>) {
  const out: { text: string; finishReason?: string }[] = [];
  for await (const c of it) out.push(c);
  return out;
}

describe("Gemini adapter (real SDK, mocked transport)", () => {
  it("streams text, sends system instruction, disables continuation & thinking overhead", async () => {
    const calls: MockCall[] = [];
    const f = mockGeminiFetch({ steps: [{ data: textChunk("مرحبا ") }, { data: textChunk("بك", "STOP") }] }, calls);
    const it = await geminiProvider({ apiKey: "k", model: "gemini-3.5-flash-lite", prompt, signal: new AbortController().signal, thinkingLevel: "minimal", fetchImpl: f });
    const chunks = await collect(it);
    expect(chunks.map((c) => c.text).join("")).toBe("مرحبا بك");
    expect(chunks.at(-1)?.finishReason).toBe("STOP");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("gemini-3.5-flash-lite:streamGenerateContent");
    const body = calls[0]!.body as { systemInstruction?: unknown; generationConfig?: Record<string, unknown> };
    expect(JSON.stringify(body.systemInstruction)).toContain("precise Arabic and English writing editor");
    expect(body.generationConfig?.thinkingConfig).toMatchObject({ thinkingLevel: "MINIMAL" });
    expect(body.generationConfig?.candidateCount).toBe(1);
    expect(JSON.stringify(body)).not.toContain("automaticContinuation");
  });

  it("does not retry inside the SDK on 503 (client owns retries)", async () => {
    const calls: MockCall[] = [];
    const f = mockGeminiFetch({ status: 503, error: { error: { code: 503, status: "UNAVAILABLE", message: "overloaded" } } }, calls);
    await expect(geminiProvider({ apiKey: "k", model: "m-x", prompt, signal: new AbortController().signal, fetchImpl: f })).rejects.toBeInstanceOf(ApiError);
    expect(calls).toHaveLength(1);
  });

  it("does not auto-resume a dropped stream (no hidden concatenation)", async () => {
    const calls: MockCall[] = [];
    const f = mockGeminiFetch({ steps: [{ data: textChunk("part") }, { drop: true }] }, calls);
    const it = await geminiProvider({ apiKey: "k", model: "m-x", prompt, signal: new AbortController().signal, fetchImpl: f });
    await expect(collect(it)).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it("abort signal tears down the underlying request", async () => {
    const calls: MockCall[] = [];
    const ac = new AbortController();
    const f = mockGeminiFetch({ steps: [{ data: textChunk("a") }, { stall: true }] }, calls);
    const it = await geminiProvider({ apiKey: "k", model: "m-x", prompt, signal: ac.signal, fetchImpl: f });
    const iter = it[Symbol.asyncIterator]();
    await iter.next();
    setTimeout(() => ac.abort(), 10);
    await expect(iter.next()).rejects.toThrow();
    expect(calls[0]!.aborted()).toBe(true);
  });
});

describe("provider error mapping", () => {
  const err = (status: number, body: unknown) => new ApiError({ status, message: JSON.stringify(body) });

  it("per-minute 429 → rate_limited with RetryInfo delay", () => {
    const m = mapProviderError(
      err(429, {
        error: {
          code: 429,
          status: "RESOURCE_EXHAUSTED",
          message: "You exceeded your current quota",
          details: [
            { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier", quotaValue: "15" }] },
            { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "17s" },
          ],
        },
      }),
    );
    expect(m).toEqual({ code: "rate_limited", status: 429, retryAfter: 17 });
  });

  it("daily quota → quota_exhausted (not auto-retried)", () => {
    const m = mapProviderError(
      err(429, { error: { code: 429, status: "RESOURCE_EXHAUSTED", details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }] } }),
    );
    expect(m.code).toBe("quota_exhausted");
  });

  it("invalid API key (400) → auth_provider", () => {
    expect(mapProviderError(err(400, { error: { code: 400, status: "INVALID_ARGUMENT", message: "API key not valid. Please pass a valid API key.", details: [{ reason: "API_KEY_INVALID" }] } })).code).toBe("auth_provider");
  });
  it("403 → auth_provider, 404 → model_unavailable, 503 → overloaded, 500 → server_error, 400 → invalid", () => {
    expect(mapProviderError(err(403, { error: { status: "PERMISSION_DENIED" } })).code).toBe("auth_provider");
    expect(mapProviderError(err(404, { error: { status: "NOT_FOUND" } })).code).toBe("model_unavailable");
    expect(mapProviderError(err(503, { error: { status: "UNAVAILABLE" } })).code).toBe("provider_overloaded");
    expect(mapProviderError(err(500, { error: { status: "INTERNAL" } })).code).toBe("server_error");
    expect(mapProviderError(err(400, { error: { status: "INVALID_ARGUMENT", message: "bad field" } })).code).toBe("invalid_request");
  });
  it("transport errors → network", () => {
    expect(mapProviderError(new TypeError("fetch failed")).code).toBe("network");
  });
});
