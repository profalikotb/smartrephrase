"use client";

import { useEffect, useRef } from "react";
import { FORMATS, LENGTHS, MODES, SOURCE_LANGS, SPELLINGS, STRENGTHS, STYLES, LANGUAGES, TARGET_LANGUAGES, LIMITS, type RewriteOptions } from "@/lib/shared/options";
import type { Dict } from "@/lib/client/i18n";
import { Button, ChipGroup, Segmented, Select, Toggle } from "./ui";
import { IconChevron, IconSliders, IconX } from "./icons";

interface Props {
  t: Dict;
  options: RewriteOptions;
  onChange: (patch: Partial<RewriteOptions>) => void;
  moreOpen: boolean;
  setMoreOpen: (v: boolean) => void;
  sheetOpen: boolean;
  setSheetOpen: (v: boolean) => void;
  onReset: () => void;
  compact: boolean;
}

type Opt<T> = { value: T; label: string }[];

function useOpts(t: Dict) {
  return <K extends keyof Dict, T extends string>(group: K, values: readonly T[]): Opt<T> => values.map((v) => ({ value: v, label: (t[group] as Record<string, string>)[v]! }));
}

function advancedCount(o: RewriteOptions): number {
  return [o.length !== "similar", o.strength !== "balanced", o.format !== "preserve", o.sourceLang !== "auto", o.spelling !== "any", !!o.preserveTerms.trim(), !!o.customInstructions.trim(), o.explain].filter(Boolean).length;
}

function englishOut(o: RewriteOptions): boolean {
  return o.mode === "translate" ? o.targetLanguage === "english" : o.language === "english" || o.language === "preserve";
}

/** Text fields + toggle shared by the desktop "More options" panel and the mobile sheet. */
function FreeTextFields({ t, o, onChange, idPrefix }: { t: Dict; o: RewriteOptions; onChange: Props["onChange"]; idPrefix: string }) {
  const field = "bidi-plain resize-none rounded-xl border border-line bg-surface px-3 py-2 text-sm placeholder:text-muted/70 focus:border-accent";
  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1" htmlFor={`${idPrefix}-terms`}>
          <span className="flex justify-between text-[11px] font-semibold uppercase tracking-wide text-muted">
            <span>{t.more.preserveTerms}</span>
            <span className="tabular-nums normal-case">
              {o.preserveTerms.length}/{LIMITS.maxPreserveTermsChars}
            </span>
          </span>
          <textarea id={`${idPrefix}-terms`} dir="auto" rows={2} value={o.preserveTerms} maxLength={LIMITS.maxPreserveTermsChars} onChange={(e) => onChange({ preserveTerms: e.target.value })} placeholder={t.more.preserveTermsHint} className={field} />
        </label>
        <label className="flex flex-col gap-1" htmlFor={`${idPrefix}-custom`}>
          <span className="flex justify-between text-[11px] font-semibold uppercase tracking-wide text-muted">
            <span>{t.more.custom}</span>
            <span className="tabular-nums normal-case">
              {o.customInstructions.length}/{LIMITS.maxCustomInstructionChars}
            </span>
          </span>
          <textarea id={`${idPrefix}-custom`} dir="auto" rows={2} value={o.customInstructions} maxLength={LIMITS.maxCustomInstructionChars} onChange={(e) => onChange({ customInstructions: e.target.value })} placeholder={t.more.customHint} className={field} />
        </label>
      </div>
      <Toggle id={`${idPrefix}-explain`} label={t.more.explain} checked={o.explain} onChange={(explain) => onChange({ explain })} />
    </>
  );
}

export function Controls({ t, options: o, onChange, moreOpen, setMoreOpen, sheetOpen, setSheetOpen, onReset, compact }: Props) {
  const opts = useOpts(t);
  const translating = o.mode === "translate";
  const adv = advancedCount(o);
  const langLabel = translating ? `→ ${t.target[o.targetLanguage]}` : t.language[o.language];

  return (
    <div className={`no-print shrink-0 ${compact ? "hidden" : ""}`}>
      <div className="flex flex-wrap items-end gap-2 lg:flex-nowrap">
        <div className="w-full min-w-0 lg:w-auto">
          <Segmented name="mode" label={t.mode.label} value={o.mode} onChange={(mode) => onChange({ mode })} options={opts("mode", MODES)} />
        </div>

        {/* Phones & tablets: one tappable summary that opens the settings sheet */}
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-haspopup="dialog"
          className="tap flex h-11 w-full min-w-0 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-start shadow-[var(--shadow)] lg:hidden"
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
            <IconSliders width={16} height={16} />
          </span>
          <span className="min-w-0 flex-1 truncate text-[14px]">
            <span className="font-semibold">{t.style[o.style]}</span>
            <span className="text-muted"> · {langLabel}</span>
          </span>
          {adv > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] font-semibold text-accent-ink">{adv}</span>}
          <span className="text-[12.5px] font-medium text-accent">{t.more.settings}</span>
        </button>

        {/* Desktop: inline controls */}
        <div className="hidden min-w-0 flex-none grid-cols-[11rem_11rem_auto] items-end gap-2 lg:grid">
          <Select id="style" label={t.style.label} value={o.style} onChange={(style) => onChange({ style })} options={opts("style", STYLES)} />
          {translating ? (
            <Select id="target" label={t.target.label} value={o.targetLanguage} onChange={(targetLanguage) => onChange({ targetLanguage })} options={opts("target", TARGET_LANGUAGES)} />
          ) : (
            <Select id="language" label={t.language.label} value={o.language} onChange={(language) => onChange({ language })} options={opts("language", LANGUAGES)} />
          )}
          <Button variant={moreOpen ? "soft" : "ghost"} className="h-9 border border-line bg-surface" aria-expanded={moreOpen} aria-controls="more-options" onClick={() => setMoreOpen(!moreOpen)} icon={<IconSliders />}>
            {t.more.toggle}
            {adv > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] text-accent-ink">{adv}</span>}
            <IconChevron className={`transition-transform ${moreOpen ? "rotate-180" : ""}`} width={14} height={14} />
          </Button>
        </div>
      </div>

      {moreOpen && (
        <div id="more-options" className="fade-in mt-2 hidden rounded-2xl border border-line bg-surface p-3 shadow-[var(--shadow)] lg:block">
          <div className="grid grid-cols-5 gap-2">
            <Select id="length" label={t.length.label} value={o.length} onChange={(length) => onChange({ length })} options={opts("length", LENGTHS)} />
            <Select id="strength" label={t.strength.label} value={o.strength} onChange={(strength) => onChange({ strength })} options={opts("strength", STRENGTHS)} />
            <Select id="format" label={t.format.label} value={o.format} onChange={(format) => onChange({ format })} options={opts("format", FORMATS)} />
            <Select id="sourceLang" label={t.sourceLang.label} value={o.sourceLang} onChange={(sourceLang) => onChange({ sourceLang })} options={opts("sourceLang", SOURCE_LANGS)} />
            {englishOut(o) && <Select id="spelling" label={t.spelling.label} value={o.spelling} onChange={(spelling) => onChange({ spelling })} options={opts("spelling", SPELLINGS)} />}
          </div>
          <div className="mt-3">
            <FreeTextFields t={t} o={o} onChange={onChange} idPrefix="desk" />
          </div>
          <div className="mt-1 flex justify-end border-t border-line pt-2">
            <Button compact onClick={onReset}>
              {t.more.reset}
            </Button>
          </div>
        </div>
      )}

      <SettingsSheet t={t} o={o} onChange={onChange} open={sheetOpen} onClose={() => setSheetOpen(false)} onReset={onReset} />
    </div>
  );
}

function SettingsSheet({ t, o, onChange, open, onClose, onReset }: { t: Dict; o: RewriteOptions; onChange: Props["onChange"]; open: boolean; onClose: () => void; onReset: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const opts = useOpts(t);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="sheet-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="sheet border border-line bg-surface p-0 text-ink shadow-2xl"
    >
      {open && (
        <div className="flex max-h-[88dvh] flex-col">
          <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-line sm:hidden" aria-hidden />
          <header className="flex shrink-0 items-center justify-between px-4 pb-2 pt-2">
            <h2 id="sheet-title" className="text-base font-semibold">
              {t.more.settings}
            </h2>
            <Button iconOnly icon={<IconX />} onClick={onClose}>
              {t.privacy.close}
            </Button>
          </header>
          <div className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-4">
            <ChipGroup name="s-style" label={t.style.label} value={o.style} onChange={(style) => onChange({ style })} options={opts("style", STYLES)} />
            {o.mode === "translate" ? (
              <ChipGroup name="s-target" label={t.target.label} value={o.targetLanguage} onChange={(targetLanguage) => onChange({ targetLanguage })} options={opts("target", TARGET_LANGUAGES)} />
            ) : (
              <ChipGroup name="s-lang" label={t.language.label} value={o.language} onChange={(language) => onChange({ language })} options={opts("language", LANGUAGES)} />
            )}
            <ChipGroup name="s-length" label={t.length.label} value={o.length} onChange={(length) => onChange({ length })} options={opts("length", LENGTHS)} />
            <ChipGroup name="s-strength" label={t.strength.label} value={o.strength} onChange={(strength) => onChange({ strength })} options={opts("strength", STRENGTHS)} />
            <ChipGroup name="s-format" label={t.format.label} value={o.format} onChange={(format) => onChange({ format })} options={opts("format", FORMATS)} />
            <ChipGroup name="s-src" label={t.sourceLang.label} value={o.sourceLang} onChange={(sourceLang) => onChange({ sourceLang })} options={opts("sourceLang", SOURCE_LANGS)} />
            {englishOut(o) && <ChipGroup name="s-spell" label={t.spelling.label} value={o.spelling} onChange={(spelling) => onChange({ spelling })} options={opts("spelling", SPELLINGS)} />}
            <FreeTextFields t={t} o={o} onChange={onChange} idPrefix="sheet" />
          </div>
          <footer className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-3">
            <Button onClick={onReset}>{t.more.reset}</Button>
            <Button variant="cta" className="tap h-11 flex-1 justify-center" onClick={onClose}>
              {t.more.apply}
            </Button>
          </footer>
        </div>
      )}
    </dialog>
  );
}
