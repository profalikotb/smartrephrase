"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_OPTIONS, charLength, requestFingerprint, type RewriteOptions, type Variant } from "@/lib/shared/options";
import { MANUALLY_RETRYABLE, type ErrorCode } from "@/lib/shared/errors";
import { checkFidelity, splitTerms } from "@/lib/shared/fidelity";
import { parseOutput } from "@/lib/shared/output";
import { detectScript, textDirection, tidyOutput, wordCount } from "@/lib/shared/text";
import { DICTS, fmt, type UiLang } from "@/lib/client/i18n";
import { DEFAULT_PREFS, addHistory, deleteSavedText, loadDraft, loadHistory, loadPrefs, saveDraft, savePrefs, type HistoryEntry, type Prefs, type ThemePref } from "@/lib/client/persistence";
import { useRephrase } from "@/lib/client/useRephrase";
import { useAbbreviations } from "@/lib/client/useAbbreviations";
import { countExpandable, expandAll, expandOnInsert, revertExpansion, suggest, tokenBefore, type Abbreviation, type ExpandResult } from "@/lib/shared/abbreviations";
import { fileStamp, useElapsed, useOnline, useVisualViewport } from "@/lib/client/hooks";
import { IN_FLIGHT, type ResultRecord } from "@/lib/client/state";
import { Controls } from "./Controls";
import { ResultPane, type ResultView } from "./ResultPane";
import { ConfirmDialog, LoginGate, PrivacyDialog, Toast } from "./Dialogs";
import { AbbreviationsDialog } from "./AbbreviationsDialog";
import { Button, Chip } from "./ui";
import { IconAbbr, IconPlus, IconLogout, IconMonitor, IconMoon, IconPaste, IconRetry, IconCheck, IconCopy, IconShare, IconShield, IconSparkle, IconStop, IconSun, IconTrash, IconWifiOff } from "./icons";

interface SessionInfo {
  required: boolean;
  authenticated: boolean;
  configured: boolean;
  issues?: string[];
}

const THEMES: ThemePref[] = ["system", "light", "dark"];

export function App({ modelName, maxChars }: { modelName: string; maxChars: number }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [hydrated, setHydrated] = useState(false);
  const [source, setSource] = useState("");
  const [restorable, setRestorable] = useState<string | null>(null);
  const [tab, setTab] = useState<"original" | "result">("original");
  const [moreOpen, setMoreOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [showPrevious, setShowPrevious] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [wasOffline, setWasOffline] = useState(false);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const [abbrOpen, setAbbrOpen] = useState(false);
  const [abbrPrefill, setAbbrPrefill] = useState("");
  const [caret, setCaret] = useState<number | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const lastExpansion = useRef<ExpandResult["expansion"] | null>(null);
  /** After the user undoes an expansion, don't re-expand that same word when they type the next space. */
  const suppressed = useRef<{ start: number; abbr: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rp = useRephrase();
  const abbr = useAbbreviations(Boolean(session && (!session.required || session.authenticated)));
  const { state } = rp;
  const online = useOnline();
  const keyboardOpen = useVisualViewport();
  const t = DICTS[prefs.uiLang];
  const uiDir = prefs.uiLang === "ar" ? "rtl" : "ltr";

  const notify = useCallback((m: string) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  // ---------- Hydration from local storage (client only) ----------
  useEffect(() => {
    const nav = (navigator.language || "").toLowerCase().startsWith("ar") ? "ar" : "en";
    const p = loadPrefs(nav);
    /* eslint-disable react-hooks/set-state-in-effect -- one-time hydration from localStorage after mount */
    setPrefs(p);
    setSource(loadDraft(p));
    setHistory(loadHistory(p));
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (hydrated && !savePrefs(prefs)) {
      /* storage blocked — app still works in memory */
    }
  }, [prefs, hydrated]);

  // Debounced draft persistence (only when explicitly enabled and not in private mode).
  useEffect(() => {
    if (!hydrated) return;
    const id = setTimeout(() => saveDraft(prefs, source), 600);
    return () => clearTimeout(id);
  }, [source, prefs, hydrated]);

  // ---------- Theme & direction ----------
  useEffect(() => {
    const root = document.documentElement;
    root.lang = prefs.uiLang;
    root.dir = uiDir;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      root.dataset.theme = prefs.theme === "system" ? (mq.matches ? "dark" : "light") : prefs.theme;
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [prefs.theme, prefs.uiLang, uiDir]);

  // ---------- Session / access control ----------
  const refreshSession = useCallback(async () => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin", signal: ctl.signal });
      if (r.ok) setSession((await r.json()) as SessionInfo);
    } catch {
      /* offline: editing still works; generation will report the problem */
    } finally {
      clearTimeout(timer);
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; state is set after the await
    void refreshSession();
  }, [refreshSession]);
  useEffect(() => {
    if (state.errorCode === "auth_required") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reacts to a server verdict
      setSession((s) => ({ required: true, authenticated: false, configured: s?.configured ?? true }));
    }
  }, [state.errorCode]);

  // ---------- Service worker (app shell only; never API responses) ----------
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);

  // ---------- Online/offline (advisory) ----------
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors an external signal
    if (!online) setWasOffline(true);
  }, [online]);

  // ---------- Result bookkeeping ----------
  const result = state.result;
  const op = state.op;
  const inFlight = IN_FLIGHT.has(state.status);
  const altOp = inFlight && op?.variant === "alternatives";
  const mainOp = inFlight && op?.variant === "single";

  // New completed result → reset edit state, record history.
  const lastResultId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!result || result.opId === lastResultId.current) return;
    lastResultId.current = result.opId;
    /* eslint-disable react-hooks/set-state-in-effect -- derived resets when a new result arrives */
    setEditText(null);
    setUndoStack([]);
    setEditing(false);
    setShowPrevious(false);
    const main = parseOutput(result.text).main;
    if (prefs.saveHistory && !prefs.privateMode && main && !result.opId.startsWith("h-")) {
      setHistory(addHistory(prefs, { id: result.opId, createdAt: result.createdAt, source: result.sourceText, result: tidyOutput(main), options: result.options }));
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [result, prefs]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a newly failed op should show its partial first
    if (state.partial) setShowPrevious(false);
  }, [state.partial]);

  const parsedResult = useMemo(() => (result ? parseOutput(result.text) : undefined), [result]);
  const mainText = parsedResult ? tidyOutput(parsedResult.main) : "";
  const displayText = editText ?? mainText;

  const view: ResultView = useMemo(() => {
    if (mainOp) {
      if (state.live) return { kind: "live", text: parseOutput(state.live).main };
      return { kind: "waiting", previous: mainText || undefined };
    }
    if (state.partial && state.partial.variant === "single" && !showPrevious) {
      const parsed = parseOutput(state.partial.text);
      const reason = state.partial.finish === "truncated" ? "truncated" : state.partial.finish === "blocked" ? "blocked" : "interrupted";
      return { kind: "partial", text: tidyOutput(parsed.main), parsed, reason };
    }
    if (result && parsedResult) return { kind: "result", text: displayText, parsed: parsedResult, edited: editText !== null };
    return { kind: "empty" };
  }, [mainOp, state.live, state.partial, showPrevious, result, parsedResult, displayText, editText, mainText]);

  const fidelity = useMemo(() => {
    const rec: ResultRecord | undefined = view.kind === "partial" ? state.partial : view.kind === "result" ? result : undefined;
    if (!rec || (view.kind !== "result" && view.kind !== "partial")) return [];
    return checkFidelity(rec.sourceText, view.text, {
      translated: rec.options.mode === "translate" || (rec.options.language !== "preserve" && detectScript(rec.sourceText) !== detectScript(view.text)),
      shortened: rec.options.mode === "shorten" || rec.options.length === "shorter",
      preserveTerms: splitTerms(rec.options.preserveTerms),
    });
  }, [view, result, state.partial]);

  const alternatives = useMemo(() => {
    if (!result) return undefined;
    if (altOp) {
      const pl = parseOutput(state.live);
      return { live: [pl.main, ...pl.alternatives].filter(Boolean).join("\n\n— — —\n\n"), busy: true };
    }
    const alt = state.alternatives;
    if (alt && alt.sourceText === result.sourceText) {
      const p = parseOutput(alt.text);
      return { versions: [p.main, ...p.alternatives].map(tidyOutput).filter(Boolean).slice(0, 2), busy: false };
    }
    return undefined;
  }, [result, altOp, state.live, state.alternatives]);

  // ---------- Derived input info ----------
  const chars = useMemo(() => charLength(source), [source]);
  const words = useMemo(() => wordCount(source), [source]);
  const over = chars - maxChars;
  const detected = useMemo(() => detectScript(source), [source]);
  const sourceDir = textDirection(source, uiDir);
  const inputChanged = Boolean(result && source !== result.sourceText);
  const settingsChanged = Boolean(result && requestFingerprint(result.sourceText, prefs.options, "single") !== result.fingerprint);

  // ---------- Actions ----------
  const setOptions = useCallback((patch: Partial<RewriteOptions>) => setPrefs((p) => ({ ...p, options: { ...p.options, ...patch } })), []);
  const setPref = useCallback(
    (patch: Partial<Prefs>) => {
      const next = { ...prefs, ...patch };
      if (patch.privateMode) deleteSavedText();
      if (patch.rememberDraft === false || patch.privateMode) saveDraft({ ...prefs, rememberDraft: true, privateMode: false }, "");
      setHistory(loadHistory(next));
      setPrefs(next);
      // Enabling draft memory saves the current text immediately (debounced effect handles later edits).
      if (patch.rememberDraft) saveDraft(next, source);
    },
    [prefs, source],
  );

  const canSubmit = source.trim().length > 0 && over <= 0;

  // ---------- Abbreviations ----------
  useLayoutEffect(() => {
    const el = sourceRef.current;
    if (el && pendingCaret.current !== null) {
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      setCaret(pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [source]);

  const onSourceChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      const pos = e.target.selectionStart ?? value.length;
      const ne = e.nativeEvent as InputEvent;
      const type = ne.inputType ?? "";
      const exp = lastExpansion.current;
      lastExpansion.current = null;

      // Backspace right after an expansion → back to the abbreviation.
      if (exp && type === "deleteContentBackward") {
        const back = revertExpansion(value, pos, exp);
        if (back) {
          suppressed.current = { start: exp.start, abbr: exp.abbr };
          pendingCaret.current = back.caret;
          setSource(back.text);
          return;
        }
      }
      if (prefs.abbrExpand) {
        const inserted = type === "insertLineBreak" || type === "insertParagraph" ? "\n" : type.startsWith("insert") ? (ne.data ?? "") : "";
        let r = expandOnInsert(value, pos, inserted, abbr.map);
        const sup = suppressed.current;
        if (r && sup && r.expansion.start === sup.start && r.expansion.abbr === sup.abbr) r = null;
        if (inserted) suppressed.current = null;
        if (r) {
          lastExpansion.current = r.expansion;
          pendingCaret.current = r.caret;
          setSource(r.text);
          return;
        }
      }
      setCaret(pos);
      setSource(value);
    },
    [prefs.abbrExpand, abbr.map],
  );

  const syncCaret = useCallback((e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    setCaret(el.selectionStart === el.selectionEnd ? el.selectionStart : null);
  }, []);

  const currentToken = useMemo(() => (caret !== null && caret <= source.length ? tokenBefore(source, caret) : null), [caret, source]);
  const suggestions = useMemo(() => (currentToken && currentToken.token.length >= 2 ? suggest(currentToken.token, abbr.entries, 6) : []), [currentToken, abbr.entries]);
  const expandableCount = useMemo(() => {
    if (source.length >= 20_000) return 0;
    const n = countExpandable(source, abbr.map);
    // The word still being typed will expand on its own when a space follows — don't nag about it.
    return currentToken && prefs.abbrExpand && abbr.map.has(currentToken.token.toUpperCase()) ? n - 1 : n;
  }, [source, abbr.map, currentToken, prefs.abbrExpand]);

  const insertSuggestion = useCallback(
    (a: Abbreviation) => {
      if (!currentToken) return;
      const next = source.slice(0, currentToken.start) + a.text + " " + source.slice(currentToken.end);
      lastExpansion.current = null;
      pendingCaret.current = currentToken.start + a.text.length + 1;
      setSource(next);
      sourceRef.current?.focus();
    },
    [currentToken, source],
  );

  const expandAllNow = useCallback(() => {
    const r = expandAll(source, abbr.map);
    if (!r.count) return;
    setRestorable(source);
    setSource(r.text);
    notify(fmt(t.abbr.expanded, { n: r.count }, prefs.uiLang));
  }, [source, abbr.map, notify, t, prefs.uiLang]);

  const openAbbr = useCallback(() => {
    const el = sourceRef.current;
    const sel = el && document.activeElement === el && el.selectionStart !== el.selectionEnd ? source.slice(el.selectionStart, el.selectionEnd) : "";
    setAbbrPrefill(sel);
    setAbbrOpen(true);
  }, [source]);

  const run = useCallback(
    (text: string, options: RewriteOptions, variant: Variant) => {
      if (variant === "single") {
        setTab("result");
        setEditing(false);
      }
      rp.start(text, options, variant, prefs.uiLang);
    },
    [rp, prefs.uiLang],
  );

  const rephrase = useCallback(() => {
    if (!canSubmit) return;
    let text = source;
    // An abbreviation typed as the very last word has no trailing space yet — expand it before sending.
    if (prefs.abbrExpand) {
      const trimmed = text.replace(/\s+$/, "");
      const tok = tokenBefore(trimmed, trimmed.length);
      const full = tok && abbr.map.get(tok.token.toUpperCase());
      if (tok && full) {
        text = trimmed.slice(0, tok.start) + full + text.slice(trimmed.length);
        setSource(text);
        if (charLength(text) > maxChars) return;
      }
    }
    run(text, prefs.options, "single");
  }, [canSubmit, run, source, prefs.options, prefs.abbrExpand, abbr.map, maxChars]);

  const retry = useCallback(() => {
    if (op) run(op.sourceText, op.options, op.variant);
    else rephrase();
  }, [op, run, rephrase]);

  const requestAlternatives = useCallback(() => {
    if (result) run(result.sourceText, result.options, "alternatives");
  }, [result, run]);

  const copy = useCallback(async () => {
    const text = view.kind === "result" || view.kind === "partial" ? view.text : "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      if (!ok) return notify(t.toast.copyFailed);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [view, notify, t]);

  const paste = useCallback(async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (!clip) return;
      const el = sourceRef.current;
      if (el && document.activeElement === el && el.selectionStart !== null) {
        const s = el.selectionStart;
        const e = el.selectionEnd ?? s;
        setSource((cur) => cur.slice(0, s) + clip + cur.slice(e));
      } else setSource((cur) => (cur.trim() ? `${cur.replace(/\s+$/, "")}\n\n${clip}` : clip));
      setTab("original");
    } catch {
      notify(t.toast.pasteFailed);
      sourceRef.current?.focus();
    }
  }, [notify, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- feature detection after mount
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  /** Native share sheet (WhatsApp, Mail, Notes…) — the fastest way to use a result on a phone. */
  const share = useCallback(async () => {
    const text = view.kind === "result" || view.kind === "partial" ? view.text : "";
    if (!text) return;
    try {
      await navigator.share({ text });
    } catch {
      /* user dismissed the share sheet */
    }
  }, [view]);

  const download = useCallback(() => {
    const text = view.kind === "result" || view.kind === "partial" ? view.text : "";
    if (!text) return;
    // UTF-8 with BOM so Windows editors detect Arabic correctly.
    const blob = new Blob(["﻿" + text.replace(/\n/g, "\r\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `smart-rephrase_${fileStamp(Date.now())}${view.kind === "partial" ? "_PARTIAL" : ""}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify(t.toast.downloaded);
  }, [view, notify, t]);

  const onEditText = useCallback(
    (v: string) => {
      setUndoStack((s) => (s.at(-1) === displayText ? s : [...s.slice(-49), displayText]));
      setEditText(v);
    },
    [displayText],
  );
  const toggleEdit = useCallback(() => {
    setEditing((e) => !e);
  }, []);
  const undo = useCallback(() => {
    setUndoStack((s) => {
      if (!s.length) return s;
      const prev = s[s.length - 1]!;
      setEditText(prev === mainText ? null : prev);
      return s.slice(0, -1);
    });
  }, [mainText]);
  const useAlternative = useCallback(
    (v: string) => {
      setUndoStack((s) => [...s.slice(-49), displayText]);
      setEditText(v);
    },
    [displayText],
  );
  const useAsInput = useCallback(() => {
    if (view.kind !== "result" || !view.text) return;
    setRestorable(source);
    setSource(view.text);
    setTab("original");
    sourceRef.current?.focus();
  }, [view, source]);
  const restoreOriginal = useCallback(() => {
    if (restorable === null) return;
    setSource(restorable);
    setRestorable(null);
    notify(t.toast.restored);
  }, [restorable, notify, t]);

  const doClear = useCallback(() => {
    setConfirmOpen(false);
    rp.reset();
    setSource("");
    setRestorable(null);
    setEditText(null);
    setUndoStack([]);
    setEditing(false);
    setTab("original");
    sourceRef.current?.focus();
  }, [rp]);
  const clear = useCallback(() => {
    const meaningful = source.trim().length > 40 || editText !== null || Boolean(result);
    if (meaningful) setConfirmOpen(true);
    else doClear();
  }, [source, editText, result, doClear]);

  const resetOptions = useCallback(() => {
    setPrefs((p) => ({ ...p, options: { ...DEFAULT_OPTIONS } }));
    notify(t.more.resetDone);
  }, [notify, t]);

  const openHistory = useCallback(
    (h: HistoryEntry) => {
      rp.replaceResult({ opId: `h-${h.id}`, text: h.result, complete: true, finish: "complete", variant: "single", sourceText: h.source, options: h.options, fingerprint: requestFingerprint(h.source, h.options, "single"), createdAt: h.createdAt });
      setSource(h.source);
      setPrivacyOpen(false);
      setTab("result");
    },
    [rp],
  );

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" });
    } finally {
      void refreshSession();
    }
  }, [refreshSession]);

  // Keyboard: Ctrl/⌘+Enter → rephrase, Esc → stop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (!inFlight) rephrase();
      } else if (e.key === "Escape" && inFlight && !privacyOpen && !confirmOpen) rp.cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inFlight, rephrase, rp, privacyOpen, confirmOpen]);

  // ---------- Status line ----------
  const elapsed = useElapsed(op?.startedAt, inFlight);
  const statusText = useMemo(() => {
    const code: ErrorCode | undefined = state.errorCode;
    switch (state.status) {
      case "idle":
        return "";
      case "connecting":
        return `${t.status.connecting} ${elapsed > 0 ? fmt(t.status.elapsed, { s: elapsed }, prefs.uiLang) : ""}`;
      case "generating":
        return `${t.status.generating} ${fmt(t.status.elapsed, { s: elapsed }, prefs.uiLang)}`;
      case "retrying":
        return fmt(t.status.retrying, { s: Math.ceil((state.retryDelayMs ?? 0) / 1000), a: state.attempt + 1, t: 3 }, prefs.uiLang);
      case "completed":
        return state.partial && state.partial.opId === op?.opId ? t.status.completedTruncated : t.status.completed;
      case "cancelled":
        return t.status.cancelled;
      case "offline":
        return online && wasOffline ? t.status.backOnline : t.status.offline;
      default: {
        const base = code ? t.errors[code] : t.status.error;
        return state.retryAfter ? `${base} ${fmt(t.errors.retryAfter, { s: state.retryAfter }, prefs.uiLang)}` : base;
      }
    }
  }, [state, t, elapsed, prefs.uiLang, op, online, wasOffline]);

  const tone: "danger" | "warn" | "success" | "info" | "accent" | "neutral" =
    state.status === "error" || state.status === "timed_out"
      ? "danger"
      : state.status === "offline" || state.status === "retrying" || (state.status === "completed" && state.partial)
        ? "warn"
        : state.status === "completed"
          ? "success"
          : state.status === "connecting"
            ? "info"
            : state.status === "generating"
              ? "accent"
              : "neutral";
  const TONE_CLASS = { danger: "bg-danger-soft text-danger", warn: "bg-warn-soft text-warn", success: "bg-success-soft text-success", info: "bg-info-soft text-info", accent: "bg-accent-soft text-accent", neutral: "bg-surface-2 text-muted" } as const;
  const hasResultText = view.kind === "result" && Boolean(view.text);
  const showRetry = !inFlight && state.errorCode !== undefined && MANUALLY_RETRYABLE.has(state.errorCode) && state.errorCode !== "cancelled" && op !== undefined;
  const offlineNow = !online;
  const mobileResultActions = tab === "result" && hasResultText && !inFlight && !showRetry;

  const sourcePane = (
    <section aria-labelledby="source-heading" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow)]">
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-line px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-5 w-1.5 shrink-0 rounded-full bg-source" aria-hidden />
          <h2 id="source-heading" className="text-sm font-semibold">
            {t.editor.sourceLabel}
          </h2>
          {source.trim() && <Chip tone="source">{t.detected[detected]}</Chip>}
        </div>
        <div className="flex items-center gap-0.5">
          {restorable !== null && (
            <Button compact variant="soft" onClick={restoreOriginal}>
              {t.editor.restoreOriginal}
            </Button>
          )}
          <Button compact collapseLabel icon={<IconPlus width={16} height={16} />} onMouseDown={(e) => e.preventDefault()} onClick={openAbbr} title={t.abbr.add}>
            {t.abbr.addShort}
          </Button>
          <Button compact collapseLabel icon={<IconPaste width={16} height={16} />} onClick={paste} title={t.actions.paste}>
            {t.actions.paste}
          </Button>
          <Button compact collapseLabel icon={<IconTrash width={16} height={16} />} onClick={clear} disabled={!source && !result} title={t.actions.clear}>
            {t.actions.clear}
          </Button>
        </div>
      </header>
      <textarea
        id="source-editor"
        ref={sourceRef}
        aria-label={t.editor.sourceLabel}
        aria-describedby="source-count"
        aria-invalid={over > 0}
        dir={source ? sourceDir : uiDir}
        value={source}
        onChange={onSourceChange}
        onSelect={syncCaret}
        onBlur={() => setCaret(null)}
        placeholder={t.editor.sourcePlaceholder}
        spellCheck
        autoCapitalize="sentences"
        className="prose-text bidi-plain scroll-thin block min-h-0 w-full flex-1 resize-none overscroll-contain bg-transparent px-4 py-3 text-ink placeholder:text-muted/70"
      />
      {(suggestions.length > 0 || expandableCount > 0) && (
        <div className="no-scrollbar flex shrink-0 items-center gap-1.5 overflow-x-auto border-t border-line bg-source-soft/60 px-2 py-1.5" aria-label={t.abbr.title}>
          {expandableCount > 0 && (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={expandAllNow} className="tap flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-source px-3.5 text-[13px] font-semibold text-white shadow-sm">
              <IconAbbr width={16} height={16} /> {fmt(t.abbr.expandAll, { n: expandableCount }, prefs.uiLang)}
            </button>
          )}
          {suggestions.map((a) => (
            <button
              key={a.key}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertSuggestion(a)}
              title={t.abbr.tapToInsert}
              className="tap flex h-9 max-w-[18rem] shrink-0 items-center gap-1.5 rounded-full border border-source/25 bg-surface px-3 text-[13px] shadow-sm hover:border-source/60"
            >
              <b dir="ltr" className="text-source">
                {a.key}
              </b>
              <span dir="auto" className="truncate text-muted">
                {a.text}
              </span>
            </button>
          ))}
        </div>
      )}
      <footer id="source-count" className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line px-3 py-1.5 text-[12px] text-muted">
        <span className="tabular-nums">
          {words.toLocaleString(prefs.uiLang === "ar" ? "ar-EG" : "en-GB")} {t.editor.words} ·{" "}
          <span className={over > 0 ? "font-semibold text-danger" : ""}>
            {chars.toLocaleString(prefs.uiLang === "ar" ? "ar-EG" : "en-GB")}/{maxChars.toLocaleString(prefs.uiLang === "ar" ? "ar-EG" : "en-GB")}
          </span>{" "}
          {t.editor.chars}
        </span>
        {over > 0 && (
          <span role="alert" className="text-danger">
            {fmt(t.editor.overLimit, { n: over }, prefs.uiLang)}
          </span>
        )}
      </footer>
    </section>
  );

  const resultPane = (
    <ResultPane
      t={t}
      lang={prefs.uiLang}
      view={view}
      editing={editing}
      onEditText={onEditText}
      canUndo={undoStack.length > 0 && !inFlight}
      copied={copied}
      fidelity={fidelity}
      inputChanged={inputChanged}
      settingsChanged={settingsChanged}
      hasPrevious={Boolean(result)}
      showingPrevious={showPrevious}
      alternatives={alternatives}
      busy={inFlight}
      actions={{
        copy,
        toggleEdit,
        undo,
        download,
        useAsInput,
        alternatives: requestAlternatives,
        useAlternative,
        discardPartial: rp.discardPartial,
        restart: retry,
        togglePrevious: () => setShowPrevious((v) => !v),
      }}
    />
  );

  return (
    <div className="app-shell flex flex-col" dir={uiDir}>
      <a href="#source-editor" className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        {t.skipToEditor}
      </a>
      <Toast message={toast} />

      <div className="mx-auto flex min-h-0 w-full max-w-[1400px] flex-1 flex-col gap-2 px-3 pt-2 sm:px-4 lg:gap-3 lg:pt-3">
        {/* Header */}
        <header className={`no-print bg-brand flex shrink-0 items-center justify-between gap-2 rounded-2xl px-2.5 py-2 text-white shadow-[var(--shadow)] sm:px-3 [&_button]:!text-white [&_button:hover]:!bg-white/15 ${keyboardOpen ? "hidden" : ""}`}>
          <div className="flex min-w-0 items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="" width={34} height={34} className="h-[34px] w-[34px] shrink-0 rounded-[10px] ring-1 ring-white/30" />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-[11.5px] font-medium text-white/80">{t.brand}</p>
              <h1 className="truncate text-[15.5px] font-semibold tracking-tight">{t.appName}</h1>
            </div>
          </div>
          <nav className="flex items-center gap-0.5" aria-label={t.ui.language}>
            {offlineNow && (
              <span className="me-1 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-1 text-[11.5px] font-semibold text-warn" role="status">
                <IconWifiOff width={14} height={14} />
                <span className="hidden sm:inline">{t.status.offline.split(".")[0]}</span>
              </span>
            )}
            <Button compact onClick={() => setPrefs((p) => ({ ...p, uiLang: p.uiLang === "ar" ? "en" : "ar" }))} aria-label={t.ui.language} lang={prefs.uiLang === "ar" ? "en" : "ar"}>
              {t.ui.switchTo}
            </Button>
            <Button
              iconOnly
              icon={prefs.theme === "dark" ? <IconMoon /> : prefs.theme === "light" ? <IconSun /> : <IconMonitor />}
              onClick={() => setPrefs((p) => ({ ...p, theme: THEMES[(THEMES.indexOf(p.theme) + 1) % THEMES.length]! }))}
              title={`${t.ui.theme}: ${prefs.theme === "dark" ? t.ui.themeDark : prefs.theme === "light" ? t.ui.themeLight : t.ui.themeSystem}`}
            >
              {`${t.ui.theme}: ${prefs.theme === "dark" ? t.ui.themeDark : prefs.theme === "light" ? t.ui.themeLight : t.ui.themeSystem}`}
            </Button>
            <Button iconOnly icon={<IconAbbr />} onClick={openAbbr} title={t.abbr.open}>
              {t.abbr.open}
            </Button>
            <Button iconOnly icon={<IconShield />} onClick={() => setPrivacyOpen(true)} title={t.ui.privacy}>
              {t.ui.privacy}
            </Button>
            {session?.required && session.authenticated && (
              <Button iconOnly icon={<IconLogout className="rtl:-scale-x-100" />} onClick={logout} title={t.ui.logout}>
                {t.ui.logout}
              </Button>
            )}
          </nav>
        </header>

        <Controls t={t} options={prefs.options} onChange={setOptions} moreOpen={moreOpen} setMoreOpen={setMoreOpen} sheetOpen={sheetOpen} setSheetOpen={setSheetOpen} onReset={resetOptions} compact={keyboardOpen} />

        {/* Mobile tabs */}
        <div role="tablist" aria-label={`${t.tabs.original} / ${t.tabs.result}`} className="grid shrink-0 grid-cols-2 gap-1 rounded-xl border border-line bg-surface p-0.5 lg:hidden">
          {(["original", "result"] as const).map((k) => (
            <button
              key={k}
              role="tab"
              type="button"
              id={`tab-${k}`}
              aria-selected={tab === k}
              aria-controls={`panel-${k}`}
              onClick={() => setTab(k)}
              className={`tap relative h-9 rounded-[10px] text-[13.5px] font-semibold transition-colors ${tab === k ? (k === "original" ? "bg-source-soft text-source" : "bg-accent-soft text-accent") : "text-muted hover:text-ink"}`}
            >
              {t.tabs[k]}
              {k === "result" && inFlight && tab !== "result" && <span className="absolute end-3 top-1/2 h-2 w-2 -translate-y-1/2 animate-pulse rounded-full bg-accent" aria-hidden />}
              {k === "result" && !inFlight && tab !== "result" && hasResultText && <span className="absolute end-3 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-success" aria-hidden />}
            </button>
          ))}
        </div>

        {/* Editors */}
        <main className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div id="panel-original" role="tabpanel" aria-labelledby="tab-original" className={`min-h-0 min-w-0 flex-col ${tab === "original" ? "flex" : "hidden"} lg:flex`}>
            {sourcePane}
          </div>
          <div id="panel-result" role="tabpanel" aria-labelledby="tab-result" className={`min-h-0 min-w-0 flex-col ${tab === "result" ? "flex" : "hidden"} lg:flex`}>
            {resultPane}
          </div>
        </main>
      </div>

      {/* Action bar — in normal flow at the bottom of a visual-viewport-sized shell, so the iOS keyboard never covers it */}
      <div className="no-print safe-bottom mx-auto w-full max-w-[1400px] shrink-0 px-3 pt-2 sm:px-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-2xl border border-line bg-surface p-1.5 shadow-[var(--shadow)]">
          <div className={`min-w-0 flex-1 ${showRetry || mobileResultActions || (statusText && !inFlight) ? "max-sm:basis-full" : ""} ${!statusText ? "max-sm:hidden" : ""}`} aria-live="polite" role="status">
            {statusText ? (
              <p className={`inline-flex max-w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-[12.5px] font-medium leading-snug ${TONE_CLASS[tone]}`}>
                <span className={`status-dot ${inFlight ? "live" : ""}`} aria-hidden />
                <span className="line-clamp-2">{statusText}</span>
              </p>
            ) : (
              <p className="truncate px-1.5 text-[12px] text-muted">
                {t.footer.model}: <span dir="ltr">{modelName}</span> · {fmt(t.footer.limit, { n: maxChars }, prefs.uiLang)} · <span dir="ltr">{t.actions.shortcut}</span>
              </p>
            )}
          </div>
          {showRetry && (
            <Button variant="soft" icon={<IconRetry width={16} height={16} />} onClick={retry} disabled={!canSubmit && !op} className="tap max-sm:h-12 max-sm:flex-1 max-sm:justify-center">
              {t.actions.retry}
            </Button>
          )}
          {mobileResultActions && (
            <div className="flex flex-1 gap-1.5 sm:hidden">
              <Button variant="soft" icon={copied ? <IconCheck width={18} height={18} /> : <IconCopy width={18} height={18} />} onClick={copy} className="tap h-12 flex-1 justify-center text-[15px]">
                {copied ? t.actions.copied : t.actions.copyResult}
              </Button>
              {canShare && (
                <Button variant="soft" iconOnly icon={<IconShare width={19} height={19} />} onClick={share} className="tap !h-12 !w-12" title={t.actions.share}>
                  {t.actions.share}
                </Button>
              )}
            </div>
          )}
          {inFlight ? (
            <Button variant="danger" icon={<IconStop width={16} height={16} />} onClick={rp.cancel} className="tap min-w-[7.5rem] justify-center max-sm:h-12 max-sm:flex-1 max-sm:text-[15px]">
              {t.actions.stop}
            </Button>
          ) : (
            <Button
              variant="cta"
              icon={<IconSparkle width={18} height={18} />}
              onClick={rephrase}
              disabled={!canSubmit}
              className={`tap min-w-[7.5rem] justify-center max-sm:h-12 max-sm:text-[15px] ${mobileResultActions ? "max-sm:min-w-0 max-sm:flex-none max-sm:px-4" : "max-sm:flex-1"}`}
              title={t.actions.shortcut}
            >
              {t.actions.rephrase}
            </Button>
          )}
        </div>
      </div>

      <AbbreviationsDialog
        t={t}
        lang={prefs.uiLang}
        open={abbrOpen}
        onClose={() => setAbbrOpen(false)}
        entries={abbr.entries}
        storage={abbr.storage}
        mutate={abbr.mutate}
        autoExpand={prefs.abbrExpand}
        setAutoExpand={(v) => setPrefs((p) => ({ ...p, abbrExpand: v }))}
        prefillText={abbrPrefill}
        notify={notify}
      />
      <ConfirmDialog t={t} open={confirmOpen} onCancel={() => setConfirmOpen(false)} onConfirm={doClear} />
      <PrivacyDialog
        t={t}
        open={privacyOpen}
        onClose={() => setPrivacyOpen(false)}
        prefs={prefs}
        setPref={setPref}
        history={history}
        onOpenHistory={openHistory}
        onDeleteAll={() => {
          deleteSavedText();
          setHistory([]);
          setPrefs((p) => ({ ...p, options: { ...p.options, customInstructions: "", preserveTerms: "" } }));
          notify(t.privacy.deleted);
        }}
      />
      {session?.required && !session.authenticated && <LoginGate t={t} onSuccess={refreshSession} issues={session.issues} />}
    </div>
  );
}

export type { UiLang };
