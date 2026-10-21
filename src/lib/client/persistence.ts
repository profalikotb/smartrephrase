import { DEFAULT_OPTIONS, sanitizeOptions, type RewriteOptions } from "@/lib/shared/options";
import type { UiLang } from "./i18n";

export type ThemePref = "system" | "light" | "dark";

export interface Prefs {
  uiLang: UiLang;
  theme: ThemePref;
  options: RewriteOptions;
  rememberDraft: boolean;
  saveHistory: boolean;
  privateMode: boolean;
  /** Expand abbreviations while typing in the original editor. */
  abbrExpand: boolean;
}

export interface HistoryEntry {
  id: string;
  createdAt: number;
  source: string;
  result: string;
  options: RewriteOptions;
}

export const KEYS = { prefs: "sr:prefs:v1", draft: "sr:draft:v1", history: "sr:history:v1" } as const;
export const HISTORY_MAX = 20;

export const DEFAULT_PREFS: Prefs = { uiLang: "ar", theme: "system", options: DEFAULT_OPTIONS, rememberDraft: false, saveHistory: false, privateMode: false, abbrExpand: true };

/** Every storage access is guarded: Safari private mode, blocked cookies and quota errors must never break the app. */
function store(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function read<T>(key: string): T | undefined {
  try {
    const v = store()?.getItem(key);
    return v ? (JSON.parse(v) as T) : undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    const s = store();
    if (!s) return false;
    s.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function remove(key: string): void {
  try {
    store()?.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function loadPrefs(defaultLang: UiLang = DEFAULT_PREFS.uiLang): Prefs {
  const p = read<Partial<Prefs>>(KEYS.prefs) ?? {};
  return {
    uiLang: p.uiLang === "en" || p.uiLang === "ar" ? p.uiLang : defaultLang,
    theme: p.theme === "light" || p.theme === "dark" ? p.theme : "system",
    // Options never contain source text, but custom instructions / preserved terms can be personal: drop them in private mode.
    options: sanitizeOptions(p.privateMode ? { ...p.options, customInstructions: "", preserveTerms: "" } : p.options),
    rememberDraft: p.rememberDraft === true && p.privateMode !== true,
    saveHistory: p.saveHistory === true && p.privateMode !== true,
    privateMode: p.privateMode === true,
    abbrExpand: p.abbrExpand !== false,
  };
}

export function savePrefs(p: Prefs): boolean {
  const options = p.privateMode ? { ...p.options, customInstructions: "", preserveTerms: "" } : p.options;
  return write(KEYS.prefs, { ...p, options });
}

export function canPersistText(p: Prefs): boolean {
  return !p.privateMode && p.rememberDraft;
}

export function loadDraft(p: Prefs): string {
  if (!canPersistText(p)) return "";
  const d = read<{ text?: unknown }>(KEYS.draft);
  return typeof d?.text === "string" ? d.text : "";
}

export function saveDraft(p: Prefs, text: string): boolean {
  if (!canPersistText(p)) return false;
  if (!text) {
    remove(KEYS.draft);
    return true;
  }
  return write(KEYS.draft, { text, savedAt: Date.now() });
}

export function loadHistory(p: Prefs): HistoryEntry[] {
  if (p.privateMode || !p.saveHistory) return [];
  const h = read<HistoryEntry[]>(KEYS.history);
  return Array.isArray(h) ? h.filter((e) => e && typeof e.source === "string" && typeof e.result === "string").slice(0, HISTORY_MAX) : [];
}

export function addHistory(p: Prefs, e: HistoryEntry): HistoryEntry[] {
  if (p.privateMode || !p.saveHistory) return [];
  const next = [e, ...loadHistory(p).filter((x) => x.id !== e.id)].slice(0, HISTORY_MAX);
  write(KEYS.history, next);
  return next;
}

/** Removes every piece of user text this app ever stored on the device. Preferences (theme, language) are kept. */
export function deleteSavedText(): void {
  remove(KEYS.draft);
  remove(KEYS.history);
  const p = read<Partial<Prefs>>(KEYS.prefs);
  if (p?.options) write(KEYS.prefs, { ...p, options: { ...p.options, customInstructions: "", preserveTerms: "" } });
}
