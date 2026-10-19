import { normalizeDigits } from "./text";

/**
 * Deterministic, conservative checks that surface *detectable* factual drift.
 * These are heuristics: passing them does not prove semantic equivalence.
 */
export type FidelityIssueKind = "number_missing" | "number_added" | "negation_reduced" | "laterality_changed" | "certainty_changed" | "term_missing";

export interface FidelityIssue {
  kind: FidelityIssueKind;
  value: string;
}

const NUM_RE = /\d+(?:[.,:/]\d+)*(?:\s?%)?/g;

function numbers(s: string): string[] {
  return (normalizeDigits(s).match(NUM_RE) ?? []).map((n) => n.replace(/\s/g, "").replace(/,(?=\d{3}\b)/g, ""));
}

function multiset(list: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of list) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}

const NEG_EN = /\b(?:not|no|never|none|without|neither|nor|denies|denied|negative|absent|excluded|ruled out)\b|n't\b/gi;
const NEG_AR = /(?:^|[\s(«"'،.])(?:لا|لم|لن|ليس|ليست|ليسوا|غير|بدون|دون|بلا|مافيش|ما فيش|مش|مفيش|عدم|ينفي|نفى|سلبي|سلبية|مستبعد|مستبعدة)(?=$|[\s)»"'،.؛:!?])/gu;

const LAT = [
  { key: "left", re: /\bleft\b|(?:الأيسر|الايسر|اليسرى|يسار|اليسار|أيسر|ايسر|شمال)/giu },
  { key: "right", re: /\bright\b|(?:الأيمن|الايمن|اليمنى|يمين|اليمين|أيمن|ايمن)/giu },
  { key: "bilateral", re: /\bbilateral(?:ly)?\b|(?:الجانبين|كلا الجانبين|ثنائي الجانب|ثنائية الجانب)/giu },
];

const CERTAINTY = [
  { key: "suspected", re: /\b(?:suspect(?:ed)?|suspicious|query)\b|(?:مشتبه|اشتباه|يشتبه)/giu },
  { key: "possible", re: /\b(?:possible|possibly|probable|probably|likely|unlikely)\b|(?:محتمل|محتملة|ربما|قد يكون|يحتمل|غالبا|غالباً)/giu },
  { key: "confirmed", re: /\b(?:confirmed|definite|definitely|proven)\b|(?:مؤكد|مؤكدة|تأكد|ثبت)/giu },
  { key: "excluded", re: /\b(?:excluded|ruled out)\b|(?:مستبعد|مستبعدة|استبعاد)/giu },
];

function count(re: RegExp, s: string): number {
  re.lastIndex = 0;
  return s.match(re)?.length ?? 0;
}

export interface FidelityContext {
  /** Translation changes vocabulary, so only language-neutral checks run. */
  translated: boolean;
  /** Shortening may legitimately merge repeated numbers; only missing distinct numbers are reported. */
  shortened: boolean;
  preserveTerms: string[];
}

export function checkFidelity(source: string, output: string, ctx: FidelityContext): FidelityIssue[] {
  const issues: FidelityIssue[] = [];
  if (!source.trim() || !output.trim()) return issues;

  const srcNums = multiset(numbers(source));
  const outNums = multiset(numbers(output));
  for (const [n, c] of srcNums) {
    const have = outNums.get(n) ?? 0;
    if (have === 0 || (!ctx.shortened && have < c)) issues.push({ kind: "number_missing", value: n });
  }
  for (const n of outNums.keys()) if (!srcNums.has(n)) issues.push({ kind: "number_added", value: n });

  for (const term of ctx.preserveTerms) {
    if (term && !output.toLocaleLowerCase().includes(term.toLocaleLowerCase())) issues.push({ kind: "term_missing", value: term });
  }

  if (!ctx.translated) {
    const srcNeg = count(NEG_EN, source) + count(NEG_AR, source);
    const outNeg = count(NEG_EN, output) + count(NEG_AR, output);
    if (srcNeg > 0 && outNeg < srcNeg) issues.push({ kind: "negation_reduced", value: `${srcNeg}→${outNeg}` });

    for (const { key, re } of LAT) {
      const a = count(re, source);
      const b = count(re, output);
      if ((a > 0) !== (b > 0)) issues.push({ kind: "laterality_changed", value: key });
    }
    for (const { key, re } of CERTAINTY) {
      const a = count(re, source);
      const b = count(re, output);
      if ((a > 0) !== (b > 0)) issues.push({ kind: "certainty_changed", value: key });
    }
  }
  return issues;
}

export function splitTerms(raw: string): string[] {
  return raw
    .split(/[\n,،;؛]/u)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 40);
}
