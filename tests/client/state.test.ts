import { describe, expect, it } from "vitest";
import { initialState, reducer, type Action, type OpContext, type RephraseState } from "@/lib/client/state";
import { DEFAULT_OPTIONS } from "@/lib/shared/options";

const op = (id: string, text = "src"): OpContext => ({ opId: id, sourceText: text, options: DEFAULT_OPTIONS, variant: "single", fingerprint: `fp-${text}`, startedAt: 0 });
const apply = (s: RephraseState, ...a: Action[]) => a.reduce(reducer, s);

describe("request state machine", () => {
  it("idle → connecting → generating → completed, result tied to input+settings", () => {
    const s = apply(initialState, { type: "start", op: op("a", "hello") }, { type: "generating", opId: "a" }, { type: "delta", opId: "a", text: "Hi" }, { type: "completed", opId: "a", finish: "complete", at: 1 });
    expect(s.status).toBe("completed");
    expect(s.result).toMatchObject({ text: "Hi", complete: true, sourceText: "hello", fingerprint: "fp-hello" });
  });
  it("stale/late events from superseded operations are ignored", () => {
    let s = apply(initialState, { type: "start", op: op("old") }, { type: "delta", opId: "old", text: "OLD" });
    s = apply(s, { type: "cancel", opId: "old", at: 1 }, { type: "start", op: op("new") });
    s = apply(s, { type: "delta", opId: "old", text: "LATE" }, { type: "completed", opId: "old", finish: "complete", at: 2 });
    expect(s.status).toBe("connecting");
    expect(s.live).toBe("");
    s = apply(s, { type: "delta", opId: "new", text: "NEW" }, { type: "completed", opId: "new", finish: "complete", at: 3 });
    expect(s.result?.text).toBe("NEW");
  });
  it("previous completed result survives a failed replacement; partial is labelled incomplete", () => {
    let s = apply(initialState, { type: "start", op: op("a") }, { type: "delta", opId: "a", text: "good" }, { type: "completed", opId: "a", finish: "complete", at: 1 });
    s = apply(s, { type: "start", op: op("b") }, { type: "delta", opId: "b", text: "half" }, { type: "failed", opId: "b", code: "timeout_inactivity", at: 2 });
    expect(s.status).toBe("timed_out");
    expect(s.result?.text).toBe("good");
    expect(s.partial).toMatchObject({ text: "half", complete: false });
  });
  it("events after completion/cancel cannot reopen a finished operation", () => {
    let s = apply(initialState, { type: "start", op: op("a") }, { type: "cancel", opId: "a", at: 1 });
    expect(s.status).toBe("cancelled");
    s = apply(s, { type: "delta", opId: "a", text: "x" }, { type: "generating", opId: "a" });
    expect(s.status).toBe("cancelled");
    expect(s.live).toBe("");
  });
  it("maps failure codes to states", () => {
    const fail = (code: Parameters<typeof reducer>[1] & { type: "failed" }) => apply(initialState, { type: "start", op: op("a") }, code).status;
    expect(fail({ type: "failed", opId: "a", code: "offline", at: 0 })).toBe("offline");
    expect(fail({ type: "failed", opId: "a", code: "timeout_overall", at: 0 })).toBe("timed_out");
    expect(fail({ type: "failed", opId: "a", code: "quota_exhausted", at: 0 })).toBe("error");
  });
  it("truncated completion becomes a labelled partial, not a result", () => {
    const s = apply(initialState, { type: "start", op: op("a") }, { type: "delta", opId: "a", text: "cut" }, { type: "completed", opId: "a", finish: "truncated", at: 1 });
    expect(s.result).toBeUndefined();
    expect(s.partial).toMatchObject({ complete: false, finish: "truncated" });
  });
  it("retrying clears any streamed buffer (restarts never concatenate)", () => {
    const s = apply(initialState, { type: "start", op: op("a") }, { type: "retrying", opId: "a", attempt: 1, delayMs: 10, code: "network" });
    expect(s).toMatchObject({ status: "retrying", attempt: 1, live: "" });
  });
});
