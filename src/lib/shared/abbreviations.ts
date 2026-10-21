import { z } from "zod";

export interface Abbreviation {
  key: string;
  text: string;
}

export const ABBR_LIMITS = { maxKey: 16, maxText: 500, maxEntries: 2000, maxImport: 2000 } as const;
export const ABBR_KEY_RE = /^[A-Za-z0-9]{1,16}$/;

export const abbreviationSchema = z
  .object({
    key: z.string().trim().regex(ABBR_KEY_RE).transform((k) => k.toUpperCase()),
    text: z
      .string()
      .transform((t) => t.replace(/\s+/g, " ").trim())
      .pipe(z.string().min(1).max(ABBR_LIMITS.maxText)),
  })
  .strict();

export const abbrOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("upsert"), key: z.string(), text: z.string(), previousKey: z.string().optional() }).strict(),
  z.object({ op: z.literal("delete"), key: z.string() }).strict(),
  z.object({ op: z.literal("import"), entries: z.array(z.object({ key: z.string(), text: z.string() }).strict()).max(ABBR_LIMITS.maxImport), overwrite: z.boolean() }).strict(),
  z.object({ op: z.literal("restore_defaults") }).strict(),
]);
export type AbbrOp = z.infer<typeof abbrOpSchema>;

/** Starter list (editable in the app; changes are stored, this list only seeds an empty store). */
export const DEFAULT_ABBREVIATIONS: Abbreviation[] = [
  ["CD", "CERVICAL DISC"],
  ["CDNOT", "CERVICAL DISCS NOT IMPROVED BY MEDICAL TREATMENT"],
  ["CDS", "CERVICAL DISCS"],
  ["CX", "CERVICAL"],
  ["DHO", "DR HOSAM EL OBRACHY"],
  ["DLPS", "DID LP WITH DR SYMON HALIM"],
  ["DMAL", "DR MOHAMED ALAA"],
  ["DMF", "DR MOHAMED FOUAD"],
  ["DMH", "DR MAHMOUD HEMIDA"],
  ["DSW", "DID SURGERY WITH DR"],
  ["DSYM", "DR SYMON HALIM"],
  ["DTM", "DR TAREK EL MENICIE"],
  ["DWAF", "DR MOHAMED WAFA"],
  ["ESS", "EMPTY SELLA SYNDROME"],
  ["FB", "FEES BACK"],
  ["FUNDV", "FOR FUNDUS AND VISUAL FIELD"],
  ["INBA", "BACK SPASM WITH INTACT MOTOR POWER"],
  ["INNK", "NECK SPASM WITH INTACT MOTOR POWER"],
  ["ISC", "ISHEMIC CHANGES"],
  ["LBPBIL", "LBP AND BILATERAL SCIATICA"],
  ["LBPLT", "LBP AND LT SCIATICA"],
  ["LBPRT", "LBP AND RT SCIATICA"],
  ["LD", "LUMBAR DISC"],
  ["LDNOT", "LUMBAR DISCS NOT IMPROVED BY MEDICAL TREATMENT"],
  ["LDS", "LUMBAR DISCS"],
  ["LL", "LOWER LIMB"],
  ["LPS", "LUMBAR PUNCTURE BY DR SYMON HALIM"],
  ["LSS", "LUMBOSACRAL"],
  ["LTSH", "LT SHOULDER"],
  ["MIMP", "MUCH IMPROVED FOR PHYSIOTHERAPY"],
  ["MIP", "MUCH IMPROVED FOR PHYSIOTHERAPY"],
  ["MRIBC", "MRI BRAIN WITH CONTRAST"],
  ["MRICLD", "FOR MRI CERVICAL, LUMBOSACRAL AND DYNAMIC STUDY"],
  ["MRICX", "MRI CERVICAL SPINE"],
  ["MRIDY", "MRI LSS AND DYNAMIC STUDY"],
  ["MRILD", "FOR MRI LUMBOSACRAL AND DYNAMIC STUDY"],
  ["MRILDD", "MRI LSS DEXA AND DYNAMIC STUDY"],
  ["MRISEL", "MRI SELLA WITH CONTRAST"],
  ["MRISPECT", "MRI BRAIN SPECTROSCOPY"],
  ["MTPT", "MEDICAL TREATMENT THEN PHYSIOTHERAPY"],
  ["NECKBIL", "NECK PAIN AND BILATERAL BRACHIALGIA"],
  ["NECKLT", "NECK PAIN AND LT BRACHIALGIA"],
  ["NECKRT", "NECK PAIN AND RT BRACHIALGIA"],
  ["NOTIMP", "NOT IMPROVED BY MEDICAL TREATMENT"],
  ["NPH", "NORMAL PRESSURE HYDROCEPHALUS"],
  ["PAINTH", "PAIN THERAPY"],
  ["PAP", "PAPILLEDEMA"],
  ["PLM", "PAIN LIMITING MOVEMENT"],
  ["PLX", "PLAIN X-RAY"],
  ["POLY", "POLYARTHROPATHY"],
  ["PPT", "PHYSIOTHERAPY"],
  ["PT", "PATIENT"],
  ["PTRS", "THE PATIENT REFUSED THE SURGERY"],
  ["RTSH", "RT SHOULDER"],
  ["SACBIL", "BILATERAL SACROILIATIS"],
  ["SACLT", "LT SACROILIATIS"],
  ["SACRT", "RT SACROILIATIS"],
  ["SPOND", "SPONDYLOLISTHESIS"],
  ["SPT", "FOR SELF PHYSIORTHERAPY"],
  ["UL", "UPPER LIMB"],
  ["WC", "WOUND IS CLEAN FOR FOLLOW UP"],
  ["WFS", "WAIT FOR SURGERY"],
  ["PIM", "PARTIAL IMPROVED"],
  ["RF", "RADIOFREQUENCY"],
  ["PPTN", "PHYSIOTHERAPY ON THE NECK"],
  ["PPTB", "PHYSIOTHERAPY ON THE BACK"],
  ["PPTNB", "PHYSIOTHERAPY ON THE NECK AND BACK"],
  ["DOH", "DR OSAMA ABD EL HAY"],
  ["TSS", "TRANSVERSE SINUS STENOSIS"],
].map(([key, text]) => ({ key: key!, text: text! }));

export function sortAbbreviations(list: Abbreviation[]): Abbreviation[] {
  return [...list].sort((a, b) => a.key.localeCompare(b.key, "en"));
}

export type AbbrMap = Map<string, string>;

export function toMap(list: Abbreviation[]): AbbrMap {
  return new Map(list.map((a) => [a.key.toUpperCase(), a.text]));
}

/** Characters that end an abbreviation and trigger expansion. */
export const DELIMITER_RE = /[\s.,;:!?)\]}،؛؟]/u;
const TOKEN_CHAR = /[A-Za-z0-9]/;

export interface TokenAt {
  start: number;
  end: number;
  token: string;
}

/** The alphanumeric token ending exactly at `pos` (must be preceded by a non-alphanumeric char or text start). */
export function tokenBefore(text: string, pos: number): TokenAt | null {
  let start = pos;
  while (start > 0 && TOKEN_CHAR.test(text[start - 1]!)) start--;
  if (start === pos) return null;
  // Ignore tokens glued to other letters, e.g. Arabic directly before Latin.
  if (start > 0 && /\p{L}/u.test(text[start - 1]!)) return null;
  return { start, end: pos, token: text.slice(start, pos) };
}

export interface ExpandResult {
  text: string;
  caret: number;
  expansion: { start: number; abbr: string; full: string; delimiter: string };
}

/**
 * Called after the user typed `inserted` ending at `caret`. If the inserted text ends with a delimiter and the token
 * before that delimiter is an abbreviation, returns the expanded text and new caret position.
 */
export function expandOnInsert(text: string, caret: number, inserted: string, map: AbbrMap): ExpandResult | null {
  if (!inserted || caret < 1) return null;
  const delimiter = text[caret - 1]!;
  if (!DELIMITER_RE.test(delimiter) || inserted.at(-1) !== delimiter) return null;
  const tok = tokenBefore(text, caret - 1);
  if (!tok) return null;
  const full = map.get(tok.token.toUpperCase());
  if (!full) return null;
  const next = text.slice(0, tok.start) + full + text.slice(tok.end);
  return { text: next, caret: tok.start + full.length + 1, expansion: { start: tok.start, abbr: tok.token, full, delimiter } };
}

/** Undo an expansion when the user immediately deletes the delimiter (like iOS / text expanders). */
export function revertExpansion(text: string, caret: number, exp: ExpandResult["expansion"]): { text: string; caret: number } | null {
  const end = exp.start + exp.full.length;
  if (caret !== end || text.slice(exp.start, end) !== exp.full) return null;
  return { text: text.slice(0, exp.start) + exp.abbr + text.slice(end), caret: exp.start + exp.abbr.length };
}

/** Expands every whole-token abbreviation in `text` (explicit user action, e.g. after pasting). */
export function expandAll(text: string, map: AbbrMap): { text: string; count: number } {
  let count = 0;
  const out = text.replace(/(^|[^\p{L}\p{N}])([A-Za-z0-9]{1,16})(?=$|[^\p{L}\p{N}])/gu, (m, pre: string, tok: string) => {
    const full = map.get(tok.toUpperCase());
    if (!full) return m;
    count++;
    return pre + full;
  });
  return { text: out, count };
}

export function countExpandable(text: string, map: AbbrMap): number {
  return expandAll(text, map).count;
}

/** Suggestions for the token being typed: exact match first, then prefix matches. */
export function suggest(token: string, list: Abbreviation[], limit = 6): Abbreviation[] {
  const t = token.toUpperCase();
  if (!t) return [];
  const exact = list.filter((a) => a.key === t);
  const prefix = list.filter((a) => a.key !== t && a.key.startsWith(t)).sort((a, b) => a.key.length - b.key.length || a.key.localeCompare(b.key));
  return [...exact, ...prefix].slice(0, limit);
}

/** Parses pasted lines "KEY<TAB>TEXT", "KEY,TEXT", "KEY = TEXT" or "KEY: TEXT". Header rows like "ABB FULL TEXT" are skipped. */
export function parseImport(raw: string): { entries: Abbreviation[]; skipped: number } {
  const entries: Abbreviation[] = [];
  let skipped = 0;
  for (const line of raw.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    // Prefer an explicit separator (Tab from Excel/Access, then , ; = :); fall back to the first whitespace.
    const sep = ["\t", ",", ";", "=", ":"].find((c) => l.includes(c));
    const idx = sep ? l.indexOf(sep) : l.search(/\s/);
    const key = idx > 0 ? l.slice(0, idx).trim() : "";
    const text = idx > 0 ? l.slice(idx + 1).trim() : "";
    if (!key || !text || (/^ABB/i.test(key) && /^FULL/i.test(text))) {
      skipped++;
      continue;
    }
    const m = [l, key, text];
    const parsed = abbreviationSchema.safeParse({ key: m[1], text: m[2]!.replace(/^["']|["']$/g, "") });
    if (parsed.success) entries.push(parsed.data);
    else skipped++;
  }
  return { entries, skipped };
}

export function toTsv(list: Abbreviation[]): string {
  return ["ABB\tFULL TEXT", ...sortAbbreviations(list).map((a) => `${a.key}\t${a.text}`)].join("\r\n");
}
