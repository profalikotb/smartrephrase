"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ABBR_KEY_RE, ABBR_LIMITS, parseImport, toTsv, type AbbrOp, type Abbreviation } from "@/lib/shared/abbreviations";
import { fmt, type Dict, type UiLang } from "@/lib/client/i18n";
import type { AbbrStorage } from "@/lib/client/useAbbreviations";
import { fileStamp } from "@/lib/client/hooks";
import { Button, Toggle } from "./ui";
import { IconDownload, IconEdit, IconTrash, IconX } from "./icons";

interface Props {
  t: Dict;
  lang: UiLang;
  open: boolean;
  onClose: () => void;
  entries: Abbreviation[];
  storage: AbbrStorage;
  mutate: (op: AbbrOp) => Promise<{ ok: boolean; code?: string }>;
  autoExpand: boolean;
  setAutoExpand: (v: boolean) => void;
  /** Text selected in the editor when the dialog was opened — pre-fills "Full text". */
  prefillText: string;
  notify: (m: string) => void;
}

type Form = { key: string; text: string; previousKey?: string };

export function AbbreviationsDialog(p: Props) {
  const { t } = p;
  const ref = useRef<HTMLDialogElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (p.open && !d.open) {
      d.showModal();
      setQ("");
      setImportOpen(false);
      setForm(p.prefillText.trim() ? { key: "", text: p.prefillText.trim().slice(0, ABBR_LIMITS.maxText) } : null);
    }
    if (!p.open && d.open) d.close();
  }, [p.open, p.prefillText]);

  useEffect(() => {
    if (form && !form.previousKey) keyRef.current?.focus();
  }, [form]);

  const filtered = useMemo(() => {
    const s = q.trim().toUpperCase();
    if (!s) return p.entries;
    return p.entries.filter((a) => a.key.includes(s) || a.text.toUpperCase().includes(s));
  }, [q, p.entries]);

  const keyNorm = form?.key.trim().toUpperCase() ?? "";
  const keyValid = ABBR_KEY_RE.test(keyNorm);
  const textValid = Boolean(form?.text.trim()) && (form?.text.length ?? 0) <= ABBR_LIMITS.maxText;
  const duplicate = form && keyValid && keyNorm !== form.previousKey && p.entries.some((a) => a.key === keyNorm);

  const run = async (op: AbbrOp, okMsg: string) => {
    setBusy(true);
    const r = await p.mutate(op);
    setBusy(false);
    p.notify(r.ok ? okMsg : t.abbr.syncFailed);
    return r.ok;
  };

  const save = async () => {
    if (!form || !keyValid || !textValid) return;
    if (await run({ op: "upsert", key: keyNorm, text: form.text, previousKey: form.previousKey }, t.abbr.saved)) setForm(null);
  };

  const remove = async (key: string) => {
    if (!window.confirm(fmt(t.abbr.confirmDelete, { k: key }, p.lang))) return;
    await run({ op: "delete", key }, t.abbr.deleted);
  };

  const doImport = async () => {
    const { entries, skipped } = parseImport(importText);
    if (!entries.length) return p.notify(fmt(t.abbr.imported, { n: 0, s: skipped }, p.lang));
    if (await run({ op: "import", entries, overwrite }, fmt(t.abbr.imported, { n: entries.length, s: skipped }, p.lang))) {
      setImportText("");
      setImportOpen(false);
    }
  };

  const exportTsv = () => {
    const blob = new Blob(["﻿" + toTsv(p.entries)], { type: "text/tab-separated-values;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `abbreviations_${fileStamp(Date.now())}.tsv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const storageText = p.storage === "cloud" ? t.abbr.storageCloud : p.storage === "server-memory" ? t.abbr.storageMemory : p.storage === "device" ? t.abbr.storageDevice : "…";
  const field = "w-full rounded-xl border border-line bg-surface px-3 text-[15px] placeholder:text-muted/70 focus:border-accent";

  return (
    <dialog
      ref={ref}
      aria-labelledby="abbr-title"
      onClose={p.onClose}
      onClick={(e) => {
        if (e.target === ref.current) p.onClose();
      }}
      className="sheet border border-line bg-surface p-0 text-ink shadow-2xl"
    >
      {p.open && (
        <div className="flex max-h-[88dvh] flex-col">
          <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-line sm:hidden" aria-hidden />
          <header className="flex shrink-0 items-center justify-between gap-2 px-4 pt-2">
            <div className="min-w-0">
              <h2 id="abbr-title" className="text-base font-semibold">
                {t.abbr.title}
              </h2>
              <p className={`flex items-center gap-1.5 text-[12px] ${p.storage === "cloud" ? "text-success" : p.storage === "device" ? "text-warn" : "text-muted"}`}>
                <span className="status-dot" aria-hidden />
                {storageText} · {fmt(t.abbr.count, { n: p.entries.length }, p.lang)}
              </p>
            </div>
            <Button iconOnly icon={<IconX />} onClick={p.onClose}>
              {t.privacy.close}
            </Button>
          </header>

          <div className="shrink-0 space-y-2 px-4 pt-3">
            <Toggle id="abbr-auto" label={t.abbr.autoExpand} hint={t.abbr.autoExpandHint} checked={p.autoExpand} onChange={p.setAutoExpand} />

            {form ? (
              <div className="fade-in space-y-2 rounded-2xl border border-accent/40 bg-accent-soft/50 p-3">
                {p.prefillText.trim() && !form.previousKey && form.text === p.prefillText.trim().slice(0, ABBR_LIMITS.maxText) && <p className="text-[12px] text-accent">{t.abbr.fromSelection}</p>}
                <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{t.abbr.key}</span>
                    <input
                      ref={keyRef}
                      dir="ltr"
                      value={form.key}
                      maxLength={ABBR_LIMITS.maxKey}
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck={false}
                      inputMode="text"
                      onChange={(e) => setForm({ ...form, key: e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase() })}
                      onKeyDown={(e) => e.key === "Enter" && void save()}
                      placeholder="CDNOT"
                      className={`${field} h-11 font-semibold tracking-wide`}
                    />
                  </label>
                  <label className="flex min-w-0 flex-col gap-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{t.abbr.text}</span>
                    <textarea
                      dir="auto"
                      rows={2}
                      value={form.text}
                      maxLength={ABBR_LIMITS.maxText}
                      onChange={(e) => setForm({ ...form, text: e.target.value })}
                      placeholder={t.abbr.textHint}
                      className={`${field} bidi-plain resize-none py-2`}
                    />
                  </label>
                </div>
                {form.key && !keyValid && <p className="text-[12px] text-danger">{t.abbr.invalidKey}</p>}
                {duplicate && <p className="text-[12px] text-warn">{fmt(t.abbr.exists, { k: keyNorm }, p.lang)}</p>}
                <div className="flex justify-end gap-2">
                  <Button onClick={() => setForm(null)}>{t.abbr.cancel}</Button>
                  <Button variant="cta" onClick={() => void save()} disabled={!keyValid || !textValid || busy} className="tap min-w-24 justify-center">
                    {t.abbr.save}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <input type="search" dir="auto" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.abbr.search} className={`${field} tap h-11 min-w-0 flex-1`} aria-label={t.abbr.search} />
                <Button variant="cta" onClick={() => setForm({ key: "", text: "" })} className="tap h-11 shrink-0 justify-center">
                  + {t.abbr.addShort}
                </Button>
              </div>
            )}
          </div>

          <ul className="scroll-thin mt-2 min-h-0 flex-1 divide-y divide-line overflow-y-auto overscroll-contain px-4" aria-label={t.abbr.title}>
            {filtered.length === 0 && <li className="py-6 text-center text-sm text-muted">{t.abbr.none}</li>}
            {filtered.map((a) => (
              <li key={a.key} className="flex items-center gap-2 py-2">
                <span dir="ltr" className="min-w-[4.75rem] shrink-0 rounded-lg bg-source-soft px-2 py-1 text-center text-[12.5px] font-bold tracking-wide text-source">
                  {a.key}
                </span>
                <span dir="auto" className="min-w-0 flex-1 text-[13.5px] leading-snug" style={{ textAlign: "start" }}>
                  {a.text}
                </span>
                <Button iconOnly icon={<IconEdit width={16} height={16} />} onClick={() => setForm({ key: a.key, text: a.text, previousKey: a.key })} title={t.abbr.edit}>
                  {`${t.abbr.edit} ${a.key}`}
                </Button>
                <Button iconOnly icon={<IconTrash width={16} height={16} />} onClick={() => void remove(a.key)} title={t.abbr.delete} className="!text-danger">
                  {`${t.abbr.delete} ${a.key}`}
                </Button>
              </li>
            ))}
          </ul>

          <footer className="shrink-0 border-t border-line px-4 py-2.5">
            {importOpen ? (
              <div className="fade-in space-y-2">
                <p className="text-[12px] text-muted">{t.abbr.importHint}</p>
                <textarea dir="ltr" rows={4} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder={"PPTN\tPHYSIOTHERAPY ON THE NECK\nTSS\tTRANSVERSE SINUS STENOSIS"} className={`${field} resize-none py-2 font-mono text-[13px]`} aria-label={t.abbr.importTitle} />
                <Toggle id="abbr-ow" label={t.abbr.importOverwrite} checked={overwrite} onChange={setOverwrite} />
                <div className="flex justify-end gap-2">
                  <Button onClick={() => setImportOpen(false)}>{t.abbr.cancel}</Button>
                  <Button variant="cta" onClick={() => void doImport()} disabled={!importText.trim() || busy} className="justify-center">
                    {t.abbr.importBtn}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="no-scrollbar flex gap-1 overflow-x-auto">
                <Button compact onClick={() => setImportOpen(true)}>
                  {t.abbr.importTitle}
                </Button>
                <Button compact icon={<IconDownload width={15} height={15} />} onClick={exportTsv}>
                  {t.abbr.export}
                </Button>
                <Button compact onClick={() => void run({ op: "restore_defaults" }, t.abbr.restored)}>
                  {t.abbr.restore}
                </Button>
              </div>
            )}
          </footer>
        </div>
      )}
    </dialog>
  );
}
