import { describe, expect, it } from "vitest";
import { detectScript, normalizeDigits, textDirection, tidyOutput, wordCount } from "@/lib/shared/text";
import { parseOutput } from "@/lib/shared/output";
import { checkFidelity, splitTerms } from "@/lib/shared/fidelity";
import { DEFAULT_OPTIONS, charLength, requestFingerprint, sanitizeOptions } from "@/lib/shared/options";
import { NdjsonParser } from "@/lib/shared/protocol";
import { GuardTimeout, guardStream } from "@/lib/shared/stream-guard";
import { backoffDelay } from "@/lib/shared/timeouts";

describe("script detection & direction", () => {
  it("detects Arabic RTL, English LTR and mixed text", () => {
    expect(detectScript("المريض يعاني من صداع")).toBe("ar");
    expect(detectScript("The patient has a headache")).toBe("en");
    expect(detectScript("المريض عنده lumbar disc prolapse L4-L5")).toBe("mixed");
    expect(detectScript("123 456")).toBe("unknown");
    expect(textDirection("MRI أظهرت انزلاقًا غضروفيًا", "ltr")).toBe("rtl");
    expect(textDirection("Hello عربي", "rtl")).toBe("ltr");
    expect(textDirection("12/05/2026", "rtl")).toBe("rtl");
  });
  it("counts, digits and tidy output", () => {
    expect(wordCount("  واحد  اثنان\nthree ")).toBe(3);
    expect(charLength("😀ب")).toBe(2);
    expect(normalizeDigits("٣٫٥ مجم ۱۲")).toBe("3.5 مجم 12");
    expect(tidyOutput("a  \n\n\n\nb\n")).toBe("a\n\nb");
  });
});

describe("output parser", () => {
  it("splits rewrite, flags, notes and alternatives", () => {
    const p = parseOutput("Main text\n\n@@FLAGS@@\n- “it” is ambiguous\n@@NOTES@@\n- fixed grammar");
    expect(p).toEqual({ main: "Main text", alternatives: [], flags: ["“it” is ambiguous"], notes: ["fixed grammar"] });
    const a = parseOutput("V1\n@@ALT@@\nV2\n@@FLAGS@@\n- none");
    expect(a.main).toBe("V1");
    expect(a.alternatives).toEqual(["V2"]);
    expect(a.flags).toEqual([]);
  });
  it("hides a half-received marker while streaming", () => {
    expect(parseOutput("Text\n@@FLA").main).toBe("Text");
    expect(parseOutput("Text\n@").main).toBe("Text");
    expect(parseOutput("email me @ home").main).toBe("email me @ home");
  });
});

describe("fidelity checks (heuristic)", () => {
  const ctx = { translated: false, shortened: false, preserveTerms: [] };
  it("flags a changed dose / missing number, Arabic-Indic digits normalised", () => {
    const i = checkFidelity("Paracetamol 500 mg every 8 hours for 5 days", "Paracetamol 50 mg every 8 hours for 5 days", ctx);
    expect(i).toContainEqual({ kind: "number_missing", value: "500" });
    expect(i).toContainEqual({ kind: "number_added", value: "50" });
    expect(checkFidelity("جرعة ٥٠٠ مجم", "جرعة 500 مجم", ctx)).toEqual([]);
  });
  it("flags dropped negation (English & Arabic)", () => {
    expect(checkFidelity("No weakness. Not diabetic.", "Weakness present. Diabetic.", ctx).map((x) => x.kind)).toContain("negation_reduced");
    expect(checkFidelity("المريض لا يعاني من ضعف", "المريض يعاني من ضعف", ctx).map((x) => x.kind)).toContain("negation_reduced");
    expect(checkFidelity("المريض لا يعاني من ضعف", "لا يعاني المريض من ضعف", ctx)).toEqual([]);
  });
  it("flags laterality and certainty changes", () => {
    expect(checkFidelity("Left L5 radiculopathy", "Right L5 radiculopathy", ctx).map((x) => x.value)).toEqual(expect.arrayContaining(["left", "right"]));
    expect(checkFidelity("Suspected meningioma", "Meningioma confirmed", ctx).map((x) => x.kind)).toContain("certainty_changed");
    expect(checkFidelity("ورم مشتبه في الجهة اليسرى", "ورم مؤكد في الجهة اليسرى", ctx).map((x) => x.kind)).toContain("certainty_changed");
  });
  it("preserved terms and translation mode", () => {
    expect(checkFidelity("x", "y", { ...ctx, preserveTerms: splitTerms("Dr Kotb, ACDF") })).toHaveLength(2);
    expect(checkFidelity("No pain on day 3", "لا ألم في اليوم 3", { ...ctx, translated: true })).toEqual([]);
  });
});

describe("options, protocol, guard", () => {
  it("fingerprint changes with input or settings", () => {
    const a = requestFingerprint("x", DEFAULT_OPTIONS, "single");
    expect(requestFingerprint("x", { ...DEFAULT_OPTIONS }, "single")).toBe(a);
    expect(requestFingerprint("y", DEFAULT_OPTIONS, "single")).not.toBe(a);
    expect(requestFingerprint("x", { ...DEFAULT_OPTIONS, style: "medical" }, "single")).not.toBe(a);
  });
  it("sanitizeOptions repairs field by field", () => {
    expect(sanitizeOptions({ style: "bad", mode: "translate", extra: 1 })).toEqual({ ...DEFAULT_OPTIONS, mode: "translate" });
  });
  it("NDJSON parser handles split lines and garbage", () => {
    const p = new NdjsonParser();
    const enc = new TextEncoder();
    expect(p.push(enc.encode('{"type":"delta","te'))).toEqual([]);
    expect(p.push(enc.encode('xt":"a"}\nnot json\n'))).toEqual([{ type: "delta", text: "a" }, { type: "error", error: { code: "bad_response", retryable: false } }]);
  });
  it("backoff is bounded and jittered", () => {
    expect(backoffDelay(0, () => 0)).toBe(400);
    expect(backoffDelay(0, () => 1)).toBe(800);
    expect(backoffDelay(10, () => 1)).toBe(6000);
  });
  it("stream guard aborts the controller and the abort-aware source closes", async () => {
    let closed = false;
    const ac = new AbortController();
    async function* src() {
      try {
        yield "a";
        await new Promise((_, rej) => ac.signal.addEventListener("abort", () => rej(new Error("aborted"))));
        yield "b";
      } finally {
        closed = true;
      }
    }
    const out: string[] = [];
    await expect(
      (async () => {
        for await (const x of guardStream(src(), { controller: ac, firstContentMs: 100, inactivityMs: 50, deadlineAt: Date.now() + 1000, hasContent: () => true })) out.push(x);
      })(),
    ).rejects.toBeInstanceOf(GuardTimeout);
    expect(out).toEqual(["a"]);
    expect(ac.signal.aborted).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(closed).toBe(true);
  });
  it("stream guard: overall deadline wins over a longer phase timeout", async () => {
    const ac = new AbortController();
    async function* src() {
      await new Promise((_, rej) => ac.signal.addEventListener("abort", () => rej(new Error("x"))));
      yield "never";
    }
    const t = Date.now();
    const run = async () => {
      for await (const _x of guardStream(src(), { controller: ac, firstContentMs: 5000, inactivityMs: 5000, deadlineAt: Date.now() + 80, hasContent: () => true })) void _x;
    };
    await expect(run()).rejects.toMatchObject({ kind: "overall" });
    expect(Date.now() - t).toBeLessThan(400);
  });
});
