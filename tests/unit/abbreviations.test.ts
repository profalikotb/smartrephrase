import { describe, expect, it } from "vitest";
import { DEFAULT_ABBREVIATIONS, countExpandable, expandAll, expandOnInsert, parseImport, revertExpansion, suggest, toMap, toTsv, tokenBefore } from "@/lib/shared/abbreviations";

const map = toMap(DEFAULT_ABBREVIATIONS);
const type = (before: string, ch: string) => {
  const text = before + ch;
  return expandOnInsert(text, text.length, ch, map);
};

describe("abbreviation expansion while typing", () => {
  it("ships all 69 starter abbreviations with unique keys", () => {
    expect(DEFAULT_ABBREVIATIONS).toHaveLength(69);
    expect(new Set(DEFAULT_ABBREVIATIONS.map((a) => a.key)).size).toBe(69);
    expect(map.get("CDNOT")).toBe("CERVICAL DISCS NOT IMPROVED BY MEDICAL TREATMENT");
  });
  it("expands on space, case-insensitively, keeping the delimiter and placing the caret after it", () => {
    const r = type("pt with ldnot", " ")!;
    expect(r.text).toBe("pt with LUMBAR DISCS NOT IMPROVED BY MEDICAL TREATMENT ");
    expect(r.caret).toBe(r.text.length);
  });
  it("expands on Enter and punctuation; longest exact key wins (CD vs CDS vs CDNOT)", () => {
    expect(type("CD", "\n")!.text).toBe("CERVICAL DISC\n");
    expect(type("CDS", ",")!.text).toBe("CERVICAL DISCS,");
    expect(type("x CDNOT", ".")!.text).toBe("x CERVICAL DISCS NOT IMPROVED BY MEDICAL TREATMENT.");
  });
  it("works inside Arabic text and in the middle of a line", () => {
    const text = "المريض MRICX ثم متابعة";
    const pos = "المريض MRICX ".length;
    expect(expandOnInsert(text, pos, " ", map)!.text).toBe("المريض MRI CERVICAL SPINE ثم متابعة");
  });
  it("ignores non-matches, partial words, glued tokens and non-delimiters", () => {
    expect(type("PTX", " ")).toBeNull();
    expect(type("CDN", " ")).toBeNull();
    expect(type("abcPT", " ")).toBeNull();
    expect(type("PT", "x")).toBeNull();
    expect(type("PT", "-")).toBeNull();
  });
  it("Backspace right after expansion restores the abbreviation", () => {
    const r = type("see DTM", " ")!;
    const afterBackspace = r.text.slice(0, -1);
    expect(revertExpansion(afterBackspace, afterBackspace.length, r.expansion)).toEqual({ text: "see DTM", caret: 7 });
    expect(revertExpansion(afterBackspace + "x", afterBackspace.length + 1, r.expansion)).toBeNull();
  });
  it("tokenBefore finds the word at the caret", () => {
    expect(tokenBefore("hello mri", 9)).toEqual({ start: 6, end: 9, token: "mri" });
    expect(tokenBefore("hello ", 6)).toBeNull();
  });
});

describe("suggestions, expand-all, import/export", () => {
  it("suggests exact match first, then shortest prefixes", () => {
    expect(suggest("mril", DEFAULT_ABBREVIATIONS).map((a) => a.key)).toEqual(["MRILD", "MRILDD"]);
    expect(suggest("cd", DEFAULT_ABBREVIATIONS).map((a) => a.key)).toEqual(["CD", "CDS", "CDNOT"]);
  });
  it("expandAll replaces whole tokens only", () => {
    const r = expandAll("PT: LBPRT, MTPT. PTX stays. L4-L5 stays.", map);
    expect(r.text).toBe("PATIENT: LBP AND RT SCIATICA, MEDICAL TREATMENT THEN PHYSIOTHERAPY. PTX stays. L4-L5 stays.");
    expect(r.count).toBe(3);
    expect(countExpandable("لا يوجد اختصار", map)).toBe(0);
  });
  it("parses tab, comma and spaced lists; skips the header row and invalid lines", () => {
    const { entries, skipped } = parseImport("ABB\tFULL TEXT\nPPTN\tPHYSIOTHERAPY ON THE NECK\nrf, radiofrequency\nBAD KEY!\tx\nTSS   TRANSVERSE SINUS STENOSIS\n");
    expect(entries).toEqual([
      { key: "PPTN", text: "PHYSIOTHERAPY ON THE NECK" },
      { key: "RF", text: "radiofrequency" },
      { key: "TSS", text: "TRANSVERSE SINUS STENOSIS" },
    ]);
    expect(skipped).toBe(2);
  });
  it("export round-trips through import", () => {
    expect(parseImport(toTsv(DEFAULT_ABBREVIATIONS)).entries).toHaveLength(69);
  });
});
