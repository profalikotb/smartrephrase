import { describe, expect, it } from "vitest";
import { runRephrase, abortableSleep, type RunEvent, type RunnerDeps } from "@/lib/client/runner";
import { DEFAULT_OPTIONS } from "@/lib/shared/options";
import { delta, done, err, mockApi, start, type ApiCall, type ApiPlan } from "../helpers/mock-api";

const FAST = { firstContentMs: 120, inactivityMs: 100, clientGraceMs: 30, overallMs: 1500, backoffBaseMs: 20, backoffMaxMs: 60, minAttemptBudgetMs: 100 };
const input = { text: "نص", options: DEFAULT_OPTIONS, variant: "single" as const, uiLang: "ar" as const };

function setup(plans: ApiPlan[], over: Partial<RunnerDeps> = {}, timeouts: Partial<typeof FAST> = {}) {
  const calls: ApiCall[] = [];
  const events: RunEvent[] = [];
  const sleeps: number[] = [];
  const deps: RunnerDeps = {
    fetch: mockApi(plans, calls),
    now: Date.now,
    sleep: (ms, s) => (sleeps.push(ms), abortableSleep(ms, s)),
    random: () => 0.5,
    isOnline: () => true,
    timeouts: { ...FAST, ...timeouts },
    ...over,
  };
  const ac = new AbortController();
  const run = () => runRephrase(input, ac.signal, (e) => events.push(e), deps);
  return { calls, events, sleeps, ac, run };
}
const last = (e: RunEvent[]) => e[e.length - 1];
const text = (e: RunEvent[]) => e.filter((x) => x.type === "delta").map((x) => (x as { text: string }).text).join("");

describe("client runner — happy path & streaming", () => {
  it("connecting → generating → deltas → completed; one request", async () => {
    const s = setup([{ kind: "stream", steps: [start, delta("أ"), delta("ب"), done()] }]);
    await s.run();
    expect(s.events.map((e) => e.type)).toEqual(["connecting", "generating", "delta", "delta", "completed"]);
    expect(text(s.events)).toBe("أب");
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]!.body).toMatchObject({ attempt: 0, useFallback: false, uiLang: "ar" });
  });
  it("UTF-8 multibyte characters split across network chunks decode correctly", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ type: "delta", text: "مرحبا بالعالم" }) + "\n");
    const s = setup([{ kind: "stream", steps: [start, { bytes: bytes.slice(0, 23) }, { wait: 5 }, { bytes: bytes.slice(23) }, done()] }]);
    await s.run();
    expect(text(s.events)).toBe("مرحبا بالعالم");
  });
  it("truncated / blocked finishes are reported, not presented as complete", async () => {
    const s = setup([{ kind: "stream", steps: [start, delta("x"), done("truncated")] }]);
    await s.run();
    expect(last(s.events)).toMatchObject({ type: "completed", finish: "truncated" });
  });
});

describe("client runner — timeouts & disruption", () => {
  it("delayed first response → retries with backoff, then succeeds", async () => {
    const s = setup([{ kind: "hang" }, { kind: "stream", steps: [start, delta("ok"), done()] }]);
    await s.run();
    expect(s.events.map((e) => e.type)).toEqual(["connecting", "retrying", "connecting", "generating", "delta", "completed"]);
    expect(s.calls[0]!.aborted()).toBe(true); // real cancellation of the timed-out attempt
    expect((s.events[1] as { code: string }).code).toBe("timeout_first_content");
  });
  it("stream starts then stalls → timeout_inactivity, partial kept, NO auto retry", async () => {
    const s = setup([{ kind: "stream", steps: [start, delta("Hel"), { stall: true }] }, { kind: "stream", steps: [start, delta("SHOULD NOT"), done()] }]);
    await s.run();
    expect(last(s.events)).toEqual({ type: "failed", code: "timeout_inactivity", partial: true, retryAfter: undefined });
    expect(s.calls).toHaveLength(1);
    expect(text(s.events)).toBe("Hel");
  });
  it("offline before submission → offline, no request", async () => {
    const s = setup([{ kind: "stream", steps: [done()] }], { isOnline: () => false });
    await s.run();
    expect(s.events).toEqual([{ type: "failed", code: "offline", partial: false }]);
    expect(s.calls).toHaveLength(0);
  });
  it("internet loss during generation → failed with partial, no retry, no concatenation", async () => {
    let online = true;
    const s = setup([{ kind: "stream", steps: [start, delta("part"), { wait: 10 }, { drop: true }] }], { isOnline: () => online });
    const p = s.run();
    setTimeout(() => (online = false), 5);
    await p;
    expect(last(s.events)).toMatchObject({ type: "failed", code: "offline", partial: true });
    expect(s.calls).toHaveLength(1);
  });
  it("recovery after reconnecting: a new operation (explicit Retry) succeeds", async () => {
    const a = setup([{ kind: "network-error" }], { isOnline: () => false });
    await a.run();
    expect(last(a.events)).toMatchObject({ code: "offline" });
    const b = setup([{ kind: "stream", steps: [start, delta("back"), done()] }]);
    await b.run();
    expect(last(b.events)).toMatchObject({ type: "completed" });
  });
  it("overall deadline always wins (including backoff)", async () => {
    const s = setup([{ kind: "hang" }], {}, { overallMs: 300, firstContentMs: 1000 });
    const t = Date.now();
    await s.run();
    expect(Date.now() - t).toBeLessThan(700);
    expect(last(s.events)).toMatchObject({ type: "failed" });
    expect(["timeout_overall", "timeout_first_content"]).toContain((last(s.events) as { code: string }).code);
  });
  it("stream closing without done → interrupted", async () => {
    const s = setup([{ kind: "stream", steps: [start, delta("x")] }]);
    await s.run();
    expect(last(s.events)).toMatchObject({ type: "failed", code: "interrupted", partial: true });
  });
});

describe("client runner — cancellation", () => {
  it("cancel during connection aborts the request and emits nothing further", async () => {
    const s = setup([{ kind: "hang" }]);
    const p = s.run();
    setTimeout(() => s.ac.abort(), 20);
    await p;
    expect(s.calls[0]!.aborted()).toBe(true);
    expect(s.events.map((e) => e.type)).toEqual(["connecting"]);
  });
  it("cancel during generation aborts and suppresses late deltas", async () => {
    const s = setup([{ kind: "stream", steps: [start, delta("a"), { wait: 60 }, delta("LATE"), done()] }], {}, { inactivityMs: 1000 });
    const p = s.run();
    setTimeout(() => s.ac.abort(), 25);
    await p;
    expect(text(s.events)).toBe("a");
    expect(s.events.some((e) => e.type === "completed")).toBe(false);
    expect(s.calls[0]!.aborted()).toBe(true);
  });
  it("cancel during retry backoff stops immediately with no further attempt", async () => {
    const s = setup([err(503, "provider_overloaded"), { kind: "stream", steps: [start, done()] }], {}, { backoffBaseMs: 400, backoffMaxMs: 400 });
    const p = s.run();
    setTimeout(() => s.ac.abort(), 60);
    const t = Date.now();
    await p;
    expect(Date.now() - t).toBeLessThan(250);
    expect(s.calls).toHaveLength(1);
    expect(last(s.events)?.type).toBe("retrying");
  });
  it("late response after cancellation is ignored", async () => {
    const s = setup([{ kind: "stream", delay: 80, steps: [start, delta("late"), done()] }]);
    const p = s.run();
    setTimeout(() => s.ac.abort(), 10);
    await p;
    expect(s.events.filter((e) => e.type !== "connecting")).toEqual([]);
  });
});

describe("client runner — retry policy", () => {
  it("rate limited → respects Retry-After, then succeeds", async () => {
    const s = setup([err(429, "rate_limited", { retryAfter: 0.05 }), { kind: "stream", steps: [start, delta("x"), done()] }]);
    await s.run();
    expect(s.sleeps).toEqual([50]);
    expect(last(s.events)).toMatchObject({ type: "completed" });
  });
  it("Retry-After beyond the deadline → fail now with retryAfter, no futile wait", async () => {
    const s = setup([err(429, "rate_limited", { retryAfter: 30 })]);
    await s.run();
    expect(last(s.events)).toMatchObject({ type: "failed", code: "rate_limited", retryAfter: 30 });
    expect(s.sleeps).toEqual([]);
  });
  it.each(["quota_exhausted", "auth_provider", "auth_required", "invalid_request", "input_too_long", "blocked", "empty", "not_configured"])("%s is never auto-retried", async (code) => {
    const s = setup([err(400, code), { kind: "stream", steps: [start, done()] }]);
    await s.run();
    expect(s.calls).toHaveLength(1);
    expect(last(s.events)).toMatchObject({ type: "failed", code });
  });
  it("server errors retried at most twice (3 attempts total), with growing jittered backoff", async () => {
    const s = setup([err(502, "server_error"), err(502, "server_error"), err(502, "server_error"), { kind: "stream", steps: [start, done()] }]);
    await s.run();
    expect(s.calls).toHaveLength(3);
    expect(s.sleeps).toEqual([15, 30]);
    expect(last(s.events)).toMatchObject({ type: "failed", code: "server_error" });
    expect(s.calls.map((c) => c.body.attempt)).toEqual([0, 1, 2]);
  });
  it("model unavailable → next attempt asks for the configured fallback", async () => {
    const s = setup([err(502, "model_unavailable"), { kind: "stream", steps: [start, done()] }]);
    await s.run();
    expect(s.calls[1]!.body.useFallback).toBe(true);
  });
  it("network error before output is retried; non-JSON 504 maps to timeout", async () => {
    const s = setup([{ kind: "network-error" }, { kind: "json", status: 504, body: "<html>" }, { kind: "stream", steps: [start, delta("x"), done()] }]);
    await s.run();
    expect(s.calls).toHaveLength(3);
    expect(s.events.filter((e) => e.type === "retrying").map((e) => (e as { code: string }).code)).toEqual(["network", "timeout_first_content"]);
  });
  it("budget sent to the server shrinks with each attempt", async () => {
    const s = setup([err(502, "server_error"), { kind: "stream", steps: [start, done()] }]);
    await s.run();
    expect(Number(s.calls[1]!.body.budgetMs)).toBeLessThan(Number(s.calls[0]!.body.budgetMs));
  });
});
