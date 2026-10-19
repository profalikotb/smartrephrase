"use client";

import { FORMATS, LENGTHS, MODES, SOURCE_LANGS, SPELLINGS, STRENGTHS, STYLES, LANGUAGES, TARGET_LANGUAGES, LIMITS, type RewriteOptions } from "@/lib/shared/options";
import type { Dict } from "@/lib/client/i18n";
import { Button, Segmented, Select, Toggle } from "./ui";
import { IconChevron, IconSliders } from "./icons";

interface Props {
  t: Dict;
  options: RewriteOptions;
  onChange: (patch: Partial<RewriteOptions>) => void;
  moreOpen: boolean;
  setMoreOpen: (v: boolean) => void;
  onReset: () => void;
  compact: boolean;
}

export function Controls({ t, options: o, onChange, moreOpen, setMoreOpen, onReset, compact }: Props) {
  const opts = <K extends keyof Dict>(group: K, values: readonly string[]) => values.map((v) => ({ value: v, label: (t[group] as Record<string, string>)[v]! }));
  const translating = o.mode === "translate";
  const englishOut = translating ? o.targetLanguage === "english" : o.language === "english" || o.language === "preserve";
  const advancedCount = [o.length !== "similar", o.strength !== "balanced", o.format !== "preserve", o.sourceLang !== "auto", o.spelling !== "any", !!o.preserveTerms.trim(), !!o.customInstructions.trim(), o.explain].filter(Boolean).length;

  return (
    <div className={`no-print shrink-0 ${compact ? "hidden" : ""}`}>
      <div className="flex flex-wrap items-end gap-2 lg:flex-nowrap">
        <div className="w-full min-w-0 lg:w-auto">
          <Segmented name="mode" label={t.mode.label} value={o.mode} onChange={(mode) => onChange({ mode })} options={opts("mode", MODES) as { value: RewriteOptions["mode"]; label: string }[]} />
        </div>
        <div className="grid min-w-0 flex-1 grid-cols-[1fr_1fr_auto] items-end gap-2 lg:flex-none lg:grid-cols-[11rem_11rem_auto]">
          <Select id="style" label={t.style.label} value={o.style} onChange={(style) => onChange({ style })} options={opts("style", STYLES) as { value: RewriteOptions["style"]; label: string }[]} />
          {translating ? (
            <Select id="target" label={t.target.label} value={o.targetLanguage} onChange={(targetLanguage) => onChange({ targetLanguage })} options={opts("target", TARGET_LANGUAGES) as { value: RewriteOptions["targetLanguage"]; label: string }[]} />
          ) : (
            <Select id="language" label={t.language.label} value={o.language} onChange={(language) => onChange({ language })} options={opts("language", LANGUAGES) as { value: RewriteOptions["language"]; label: string }[]} />
          )}
          <Button
            variant={moreOpen ? "soft" : "ghost"}
            className="h-9 border border-line max-sm:px-2.5"
            aria-expanded={moreOpen}
            aria-controls="more-options"
            onClick={() => setMoreOpen(!moreOpen)}
            icon={<IconSliders />}
            title={t.more.toggle}
          >
            <span className="hidden sm:inline">{t.more.toggle}</span>
            <span className="sm:hidden sr-only">{t.more.toggle}</span>
            {advancedCount > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] text-accent-ink">{advancedCount}</span>}
            <IconChevron className={`hidden transition-transform sm:block ${moreOpen ? "rotate-180" : ""}`} width={14} height={14} />
          </Button>
        </div>
      </div>

      {moreOpen && (
        <div id="more-options" className="fade-in mt-2 rounded-xl border border-line bg-surface p-3 shadow-[var(--shadow)]">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <Select id="length" label={t.length.label} value={o.length} onChange={(length) => onChange({ length })} options={opts("length", LENGTHS) as { value: RewriteOptions["length"]; label: string }[]} />
            <Select id="strength" label={t.strength.label} value={o.strength} onChange={(strength) => onChange({ strength })} options={opts("strength", STRENGTHS) as { value: RewriteOptions["strength"]; label: string }[]} />
            <Select id="format" label={t.format.label} value={o.format} onChange={(format) => onChange({ format })} options={opts("format", FORMATS) as { value: RewriteOptions["format"]; label: string }[]} />
            <Select id="sourceLang" label={t.sourceLang.label} value={o.sourceLang} onChange={(sourceLang) => onChange({ sourceLang })} options={opts("sourceLang", SOURCE_LANGS) as { value: RewriteOptions["sourceLang"]; label: string }[]} />
            {englishOut && (
              <Select id="spelling" label={t.spelling.label} value={o.spelling} onChange={(spelling) => onChange({ spelling })} options={opts("spelling", SPELLINGS) as { value: RewriteOptions["spelling"]; label: string }[]} />
            )}
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="flex justify-between text-[11px] font-medium uppercase tracking-wide text-muted">
                <span>{t.more.preserveTerms}</span>
                <span className="tabular-nums normal-case">
                  {o.preserveTerms.length}/{LIMITS.maxPreserveTermsChars}
                </span>
              </span>
              <textarea
                dir="auto"
                rows={2}
                value={o.preserveTerms}
                maxLength={LIMITS.maxPreserveTermsChars}
                onChange={(e) => onChange({ preserveTerms: e.target.value })}
                placeholder={t.more.preserveTermsHint}
                className="bidi-plain resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm placeholder:text-muted/70 focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="flex justify-between text-[11px] font-medium uppercase tracking-wide text-muted">
                <span>{t.more.custom}</span>
                <span className="tabular-nums normal-case">
                  {o.customInstructions.length}/{LIMITS.maxCustomInstructionChars}
                </span>
              </span>
              <textarea
                dir="auto"
                rows={2}
                value={o.customInstructions}
                maxLength={LIMITS.maxCustomInstructionChars}
                onChange={(e) => onChange({ customInstructions: e.target.value })}
                placeholder={t.more.customHint}
                className="bidi-plain resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm placeholder:text-muted/70 focus:border-accent"
              />
            </label>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
            <div className="min-w-[14rem] flex-1">
              <Toggle id="explain" label={t.more.explain} checked={o.explain} onChange={(explain) => onChange({ explain })} />
            </div>
            <Button compact onClick={onReset}>
              {t.more.reset}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
