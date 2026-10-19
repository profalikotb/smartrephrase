import { z } from "zod";

export const MODES = ["rephrase", "correct", "shorten", "clarify", "translate"] as const;
export const STYLES = ["natural", "professional", "formal", "friendly", "academic", "medical", "simple", "message", "email"] as const;
export const LANGUAGES = ["preserve", "msa", "egyptian", "english"] as const;
export const TARGET_LANGUAGES = ["msa", "egyptian", "english"] as const;
export const SPELLINGS = ["any", "british", "american"] as const;
export const LENGTHS = ["shorter", "similar", "detailed"] as const;
export const STRENGTHS = ["light", "balanced", "substantial"] as const;
export const FORMATS = ["preserve", "paragraphs", "bullets", "numbered"] as const;
export const SOURCE_LANGS = ["auto", "ar", "en", "mixed"] as const;
export const VARIANTS = ["single", "alternatives"] as const;

export type Mode = (typeof MODES)[number];
export type Style = (typeof STYLES)[number];
export type Language = (typeof LANGUAGES)[number];
export type TargetLanguage = (typeof TARGET_LANGUAGES)[number];
export type Spelling = (typeof SPELLINGS)[number];
export type Length = (typeof LENGTHS)[number];
export type Strength = (typeof STRENGTHS)[number];
export type Format = (typeof FORMATS)[number];
export type SourceLang = (typeof SOURCE_LANGS)[number];
export type Variant = (typeof VARIANTS)[number];

export const LIMITS = {
  /** Hard input limit in characters (Unicode code points). Enforced on client and server. */
  maxInputChars: 8000,
  maxCustomInstructionChars: 300,
  maxPreserveTermsChars: 500,
  /** Raw request body cap in bytes (UTF-8 Arabic ≈ 2 bytes/char; JSON overhead included). */
  maxBodyBytes: 64 * 1024,
  /** Upper bound on generated tokens for any request. */
  maxOutputTokensCap: 8192,
} as const;

export const optionsSchema = z
  .object({
    mode: z.enum(MODES),
    style: z.enum(STYLES),
    language: z.enum(LANGUAGES),
    targetLanguage: z.enum(TARGET_LANGUAGES),
    spelling: z.enum(SPELLINGS),
    length: z.enum(LENGTHS),
    strength: z.enum(STRENGTHS),
    format: z.enum(FORMATS),
    sourceLang: z.enum(SOURCE_LANGS),
    customInstructions: z.string().max(LIMITS.maxCustomInstructionChars),
    preserveTerms: z.string().max(LIMITS.maxPreserveTermsChars),
    explain: z.boolean(),
  })
  .strict();

export type RewriteOptions = z.infer<typeof optionsSchema>;

export const DEFAULT_OPTIONS: RewriteOptions = {
  mode: "rephrase",
  style: "natural",
  language: "preserve",
  targetLanguage: "english",
  spelling: "any",
  length: "similar",
  strength: "balanced",
  format: "preserve",
  sourceLang: "auto",
  customInstructions: "",
  preserveTerms: "",
  explain: false,
};

export const requestSchema = z
  .object({
    text: z.string(),
    options: optionsSchema,
    variant: z.enum(VARIANTS),
    /** Client attempt index (0-based). Used only to select the fallback model after an "unavailable" failure. */
    attempt: z.number().int().min(0).max(2),
    useFallback: z.boolean(),
    /** Remaining client budget in ms; server clamps its own deadline to this. */
    budgetMs: z.number().int().min(1000).max(60_000),
    /** Language for flags/notes. */
    uiLang: z.enum(["ar", "en"]),
  })
  .strict();

export type RephraseRequest = z.infer<typeof requestSchema>;

/** Code-point length — what users perceive as characters for Arabic & English. */
export function charLength(s: string): number {
  let n = s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) n--; // high surrogate: pair counts once
  }
  return n;
}

/** Stable key used to tie a result to the exact input + settings that produced it. */
export function requestFingerprint(text: string, options: RewriteOptions, variant: Variant): string {
  const ordered = Object.keys(options)
    .sort()
    .map((k) => [k, options[k as keyof RewriteOptions]]);
  const raw = JSON.stringify([text, ordered, variant]);
  // FNV-1a 32-bit over UTF-16 units — cheap, deterministic, non-cryptographic.
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(16)}-${raw.length}`;
}

export function sanitizeOptions(input: unknown): RewriteOptions {
  if (!input || typeof input !== "object") return { ...DEFAULT_OPTIONS };
  const merged = { ...DEFAULT_OPTIONS, ...(input as Record<string, unknown>) };
  const picked = Object.fromEntries(Object.keys(DEFAULT_OPTIONS).map((k) => [k, (merged as Record<string, unknown>)[k]]));
  const parsed = optionsSchema.safeParse(picked);
  if (parsed.success) return parsed.data;
  // Repair field by field so one stale value doesn't wipe all preferences.
  const out: Record<string, unknown> = { ...DEFAULT_OPTIONS };
  for (const key of Object.keys(DEFAULT_OPTIONS) as (keyof RewriteOptions)[]) {
    const single = optionsSchema.shape[key].safeParse(picked[key]);
    if (single.success) out[key] = single.data;
  }
  return out as RewriteOptions;
}
