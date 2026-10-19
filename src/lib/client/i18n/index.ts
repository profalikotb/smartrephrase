import { ar } from "./ar";
import { en, type Dict } from "./en";

export type UiLang = "ar" | "en";
export const DICTS: Record<UiLang, Dict> = { ar, en };

export function fmt(template: string, vars: Record<string, string | number> = {}, lang: UiLang = "en"): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = vars[k];
    if (v === undefined) return `{${k}}`;
    return typeof v === "number" ? v.toLocaleString(lang === "ar" ? "ar-EG" : "en-GB") : v;
  });
}

export type { Dict };
