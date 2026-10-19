export type Script = "ar" | "en" | "mixed" | "unknown";

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/gu;
const LATIN = /[A-Za-zÀ-ɏ]/g;

/** Dominant-script detection. "mixed" when the minority script exceeds 25% of letters. */
export function detectScript(text: string): Script {
  const ar = text.match(ARABIC)?.length ?? 0;
  const en = text.match(LATIN)?.length ?? 0;
  const total = ar + en;
  if (total === 0) return "unknown";
  const minority = Math.min(ar, en) / total;
  if (minority > 0.25) return "mixed";
  return ar > en ? "ar" : "en";
}

/** Base direction for an editor, independent of UI language. Mixed text follows the majority script. */
export function textDirection(text: string, fallback: "rtl" | "ltr"): "rtl" | "ltr" {
  const ar = text.match(ARABIC)?.length ?? 0;
  const en = text.match(LATIN)?.length ?? 0;
  if (ar === 0 && en === 0) return fallback;
  return ar >= en ? "rtl" : "ltr";
}

export function wordCount(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/u).length;
}

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN = "۰۱۲۳۴۵۶۷۸۹";

export function normalizeDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => {
    const i = ARABIC_INDIC.indexOf(d);
    return String(i >= 0 ? i : PERSIAN.indexOf(d));
  }).replace(/[٫]/g, ".").replace(/[٬]/g, ",");
}

/** Collapses runs of 3+ newlines and trims trailing spaces per line; never alters words. */
export function tidyOutput(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
