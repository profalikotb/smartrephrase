"use client";

import { useEffect, useRef } from "react";
import type { Dict } from "@/lib/client/i18n";
import { fmt, type UiLang } from "@/lib/client/i18n";
import type { FidelityIssue } from "@/lib/shared/fidelity";
import type { ParsedOutput } from "@/lib/shared/output";
import { textDirection } from "@/lib/shared/text";
import { BidiText } from "./BidiText";
import { Button, Chip } from "./ui";
import { IconAlert, IconCheck, IconCopy, IconDownload, IconEdit, IconRetry, IconSparkle, IconSwap, IconUndo } from "./icons";

export type ResultView =
  | { kind: "empty" }
  | { kind: "waiting"; previous?: string }
  | { kind: "live"; text: string }
  | { kind: "result"; text: string; parsed: ParsedOutput; edited: boolean }
  | { kind: "partial"; text: string; parsed: ParsedOutput; reason: "interrupted" | "truncated" | "blocked" };

interface Props {
  t: Dict;
  lang: UiLang;
  view: ResultView;
  editing: boolean;
  onEditText: (v: string) => void;
  canUndo: boolean;
  copied: boolean;
  fidelity: FidelityIssue[];
  inputChanged: boolean;
  settingsChanged: boolean;
  hasPrevious: boolean;
  showingPrevious: boolean;
  alternatives?: { live?: string; versions?: string[]; busy: boolean };
  actions: {
    copy: () => void;
    toggleEdit: () => void;
    undo: () => void;
    download: () => void;
    useAsInput: () => void;
    alternatives: () => void;
    useAlternative: (v: string) => void;
    discardPartial: () => void;
    restart: () => void;
    togglePrevious: () => void;
  };
  busy: boolean;
}

export function ResultPane(p: Props) {
  const { t, view } = p;
  const fallback = p.lang === "ar" ? "rtl" : "ltr";
  const scrollRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const liveLen = view.kind === "live" ? view.text.length : 0;

  // Follow streaming output only if the user hasn't scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || view.kind !== "live") return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [liveLen, view.kind]);

  useEffect(() => {
    if (p.editing) textRef.current?.focus();
  }, [p.editing]);

  const hasText = view.kind === "result" || view.kind === "partial";
  const text = hasText ? view.text : "";
  const parsed = hasText ? view.parsed : undefined;
  const actionable = view.kind === "result" && !p.busy;

  return (
    <section aria-labelledby="result-heading" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow)]">
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-line px-3">
        <h2 id="result-heading" className="text-sm font-semibold">
          {t.editor.resultLabel}
        </h2>
        <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
          {p.inputChanged && hasText && <Chip tone="warn">{t.editor.inputChanged}</Chip>}
          {p.settingsChanged && !p.inputChanged && view.kind === "result" && <Chip tone="neutral">{t.more.settingsChanged}</Chip>}
        </div>
      </header>

      <div ref={scrollRef} className="scroll-thin relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {view.kind === "partial" && (
          <div role="status" className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-warn-soft px-3 py-2 text-[13px] text-warn">
            <IconAlert className="shrink-0" />
            <span className="min-w-0 flex-1">
              <strong className="font-semibold">{t.partial.label}. </strong>
              {view.reason === "truncated" ? t.result.truncatedBanner : view.reason === "blocked" ? t.result.blocked : t.partial.body}
            </span>
            <span className="flex gap-1">
              <Button compact variant="soft" icon={<IconRetry width={15} height={15} />} onClick={p.actions.restart} disabled={p.busy}>
                {t.actions.restart}
              </Button>
              {p.hasPrevious && (
                <Button compact onClick={p.actions.togglePrevious}>
                  {p.showingPrevious ? t.actions.showPartial : t.actions.showPrevious}
                </Button>
              )}
              <Button compact onClick={p.actions.discardPartial}>
                {t.actions.discardPartial}
              </Button>
            </span>
          </div>
        )}

        {p.editing && view.kind === "result" ? (
          <textarea
            ref={textRef}
            aria-label={t.editor.resultEditLabel}
            dir={textDirection(text, fallback)}
            value={text}
            onChange={(e) => p.onEditText(e.target.value)}
            className="prose-text bidi-plain block h-full min-h-[12rem] w-full resize-none bg-transparent px-4 py-3 text-ink"
            spellCheck
          />
        ) : (
          <div className={`prose-text px-4 py-3 ${view.kind === "partial" ? "opacity-80" : ""}`} aria-live={view.kind === "live" ? "off" : "polite"} aria-busy={view.kind === "live" || view.kind === "waiting"}>
            {view.kind === "empty" && <p className="text-muted/80">{t.editor.resultPlaceholder}</p>}
            {view.kind === "waiting" &&
              (view.previous ? (
                <div className="opacity-45">
                  <BidiText text={view.previous} fallbackDir={fallback} />
                </div>
              ) : (
                <div className="space-y-2.5 pt-1" aria-hidden>
                  <div className="h-3 w-11/12 animate-pulse rounded bg-surface-2" />
                  <div className="h-3 w-9/12 animate-pulse rounded bg-surface-2" />
                  <div className="h-3 w-10/12 animate-pulse rounded bg-surface-2" />
                </div>
              ))}
            {view.kind === "live" && <BidiText text={view.text} fallbackDir={fallback} streaming />}
            {hasText && <BidiText text={text} fallbackDir={fallback} />}
          </div>
        )}

        {parsed && !p.editing && (parsed.flags.length > 0 || p.fidelity.length > 0 || parsed.notes.length > 0) && (
          <div className="space-y-2 px-4 pb-3">
            {parsed.flags.length > 0 && (
              <Callout tone="warn" title={t.result.flags} items={parsed.flags} fallback={fallback} />
            )}
            {p.fidelity.length > 0 && (
              <Callout
                tone="warn"
                title={t.result.fidelity}
                note={t.result.fidelityNote}
                items={p.fidelity.map((f) => fmt(t.fidelity[f.kind], { v: f.value }, p.lang))}
                fallback={fallback}
              />
            )}
            {parsed.notes.length > 0 && <Callout tone="neutral" title={t.result.notes} items={parsed.notes} fallback={fallback} />}
          </div>
        )}

        {p.alternatives && (p.alternatives.busy || (p.alternatives.versions?.length ?? 0) > 0) && view.kind === "result" && !p.editing && (
          <div className="border-t border-line px-4 py-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t.result.alternatives}</h3>
            {p.alternatives.live !== undefined ? (
              <div className="prose-text rounded-xl border border-line bg-surface-2 p-3">
                {p.alternatives.live ? <BidiText text={p.alternatives.live} fallbackDir={fallback} streaming /> : <div className="h-3 w-2/3 animate-pulse rounded bg-line/60" />}
              </div>
            ) : (
              <div className="grid gap-2">
                {p.alternatives.versions!.map((v, i) => (
                  <article key={i} className="rounded-xl border border-line bg-surface-2 p-3">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs font-medium text-muted">{fmt(t.result.alternative, { n: i + 1 }, p.lang)}</span>
                      <Button compact variant="soft" onClick={() => p.actions.useAlternative(v)}>
                        {t.actions.useThis}
                      </Button>
                    </div>
                    <div className="prose-text">
                      <BidiText text={v} fallbackDir={fallback} />
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <footer className="no-scrollbar flex shrink-0 items-center gap-0.5 justify-between sm:justify-start overflow-x-auto border-t border-line px-1.5 py-1.5">
        <Button compact collapseLabel icon={p.copied ? <IconCheck width={16} height={16} /> : <IconCopy width={16} height={16} />} title={t.actions.copy} onClick={p.actions.copy} disabled={!hasText || p.editing}>
          {p.copied ? t.actions.copied : t.actions.copy}
        </Button>
        <Button compact collapseLabel icon={p.editing ? <IconCheck width={16} height={16} /> : <IconEdit width={16} height={16} />} title={p.editing ? t.actions.doneEditing : t.actions.edit} onClick={p.actions.toggleEdit} disabled={view.kind !== "result"} aria-pressed={p.editing}>
          {p.editing ? t.actions.doneEditing : t.actions.edit}
        </Button>
        <Button compact collapseLabel icon={<IconUndo width={16} height={16} />} title={t.actions.undo} onClick={p.actions.undo} disabled={!p.canUndo}>
          {t.actions.undo}
        </Button>
        <Button compact collapseLabel icon={<IconDownload width={16} height={16} />} title={t.actions.download} onClick={p.actions.download} disabled={!hasText}>
          {t.actions.download}
        </Button>
        <Button compact collapseLabel icon={<IconSwap width={16} height={16} />} title={t.actions.useAsInput} onClick={p.actions.useAsInput} disabled={!actionable}>
          {t.actions.useAsInput}
        </Button>
        <Button compact collapseLabel icon={<IconSparkle width={16} height={16} />} title={t.actions.alternatives} onClick={p.actions.alternatives} disabled={!actionable || p.editing}>
          {t.actions.alternatives}
        </Button>
      </footer>
    </section>
  );
}

function Callout({ tone, title, items, note, fallback }: { tone: "warn" | "neutral"; title: string; items: string[]; note?: string; fallback: "rtl" | "ltr" }) {
  return (
    <div className={`rounded-xl border p-3 text-[13px] leading-relaxed ${tone === "warn" ? "border-transparent bg-warn-soft" : "border-line bg-surface-2"}`}>
      <p className={`mb-1 font-semibold ${tone === "warn" ? "text-warn" : "text-ink"}`}>{title}</p>
      <ul className="list-disc space-y-0.5 ps-5">
        {items.map((it, i) => (
          <li key={i} dir={textDirection(it, fallback)}>
            {it}
          </li>
        ))}
      </ul>
      {note && <p className="mt-1.5 text-[12px] text-muted">{note}</p>}
    </div>
  );
}
