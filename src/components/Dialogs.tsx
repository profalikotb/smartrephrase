"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Dict } from "@/lib/client/i18n";
import type { HistoryEntry, Prefs } from "@/lib/client/persistence";
import { formatDateTime } from "@/lib/client/hooks";
import { textDirection } from "@/lib/shared/text";
import { Button, Toggle } from "./ui";
import { IconShield, IconX } from "./icons";

function Modal({ open, onClose, labelledBy, children, wide }: { open: boolean; onClose: () => void; labelledBy: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={`m-auto w-[calc(100%-2rem)] ${wide ? "max-w-lg" : "max-w-sm"} max-h-[85dvh] overflow-hidden rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl`}
    >
      {open && <div className="max-h-[85dvh] overflow-y-auto p-5 scroll-thin">{children}</div>}
    </dialog>
  );
}

export function ConfirmDialog({ t, open, onCancel, onConfirm }: { t: Dict; open: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal open={open} onClose={onCancel} labelledBy="confirm-title">
      <h2 id="confirm-title" className="text-base font-semibold">
        {t.confirm.clearTitle}
      </h2>
      <p className="mt-1.5 text-sm text-muted">{t.confirm.clearBody}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onCancel} autoFocus>
          {t.actions.cancel}
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          {t.actions.confirmClear}
        </Button>
      </div>
    </Modal>
  );
}

export function PrivacyDialog({
  t,
  open,
  onClose,
  prefs,
  setPref,
  onDeleteAll,
  history,
  onOpenHistory,
}: {
  t: Dict;
  open: boolean;
  onClose: () => void;
  prefs: Prefs;
  setPref: (patch: Partial<Prefs>) => void;
  onDeleteAll: () => void;
  history: HistoryEntry[];
  onOpenHistory: (e: HistoryEntry) => void;
}) {
  const fallback = prefs.uiLang === "ar" ? "rtl" : "ltr";
  return (
    <Modal open={open} onClose={onClose} labelledBy="privacy-title" wide>
      <div className="flex items-center justify-between gap-2">
        <h2 id="privacy-title" className="flex items-center gap-2 text-base font-semibold">
          <IconShield className="text-accent" /> {t.privacy.title}
        </h2>
        <Button iconOnly icon={<IconX />} onClick={onClose}>
          {t.privacy.close}
        </Button>
      </div>
      <div className="mt-2 divide-y divide-line">
        <Toggle id="pm" label={t.privacy.privateMode} hint={t.privacy.privateModeHint} checked={prefs.privateMode} onChange={(v) => setPref(v ? { privateMode: true, rememberDraft: false, saveHistory: false } : { privateMode: false })} />
        <Toggle id="rd" label={t.privacy.rememberDraft} hint={t.privacy.rememberDraftHint} checked={prefs.rememberDraft} disabled={prefs.privateMode} onChange={(v) => setPref({ rememberDraft: v })} />
        <Toggle id="sh" label={t.privacy.history} hint={t.privacy.historyHint} checked={prefs.saveHistory} disabled={prefs.privateMode} onChange={(v) => setPref({ saveHistory: v })} />
      </div>

      {prefs.saveHistory && !prefs.privateMode && (
        <section className="mt-3">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{t.privacy.historyTitle}</h3>
          {history.length === 0 ? (
            <p className="text-sm text-muted">{t.privacy.historyEmpty}</p>
          ) : (
            <ul className="max-h-56 space-y-1.5 overflow-y-auto scroll-thin">
              {history.map((h) => (
                <li key={h.id} className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 p-2">
                  <div className="min-w-0 flex-1">
                    <p dir={textDirection(h.result, fallback)} className="truncate text-sm">
                      {h.result}
                    </p>
                    <p className="text-[11px] text-muted tabular-nums" dir="ltr" style={{ textAlign: "start" }}>
                      {formatDateTime(h.createdAt)}
                    </p>
                  </div>
                  <Button compact variant="soft" onClick={() => onOpenHistory(h)}>
                    {t.privacy.restore}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="mt-3">
        <Button variant="soft" className="w-full justify-center !text-danger !bg-danger-soft" onClick={onDeleteAll}>
          {t.privacy.deleteAll}
        </Button>
      </div>

      <section className="mt-4 rounded-xl bg-surface-2 p-3 text-[13px] leading-relaxed text-muted">
        <h3 className="mb-1 text-sm font-semibold text-ink">{t.privacy.providerTitle}</h3>
        <p>{t.privacy.providerBody}</p>
        <p className="mt-2">{t.privacy.offlineNote}</p>
      </section>
    </Modal>
  );
}

export function LoginGate({ t, onSuccess, issues = [] }: { t: Dict; onSuccess: () => void; issues?: string[] }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pw || busy) return;
    setBusy(true);
    setErr(null);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12_000);
    try {
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }), signal: ctl.signal, credentials: "same-origin" });
      if (res.ok) {
        setPw("");
        onSuccess();
      } else {
        let code: string | undefined;
        try {
          code = ((await res.json()) as { error?: { code?: string } }).error?.code;
        } catch {
          /* non-JSON */
        }
        setErr(res.status === 429 && code === "rate_limited" ? t.login.tooMany : res.status === 401 ? t.login.wrong : code && code in t.errors ? t.errors[code as keyof Dict["errors"]] : t.errors.not_configured);
      }
    } catch {
      setErr(navigator.onLine === false ? t.errors.offline : t.errors.network);
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-bg/80 p-4 backdrop-blur-sm">
      <form onSubmit={submit} className="fade-in w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl" aria-labelledby="login-title">
        <h2 id="login-title" className="text-lg font-semibold">
          {t.login.title}
        </h2>
        <p className="mt-1 text-sm text-muted">{t.login.body}</p>
        {issues.length > 0 && (
          <div role="alert" className="mt-3 rounded-lg bg-warn-soft p-3 text-[13px] leading-relaxed text-warn">
            <p className="font-semibold">{t.setup.title}</p>
            <ul className="mt-1 list-disc ps-5">
              {issues.map((i) => (
                <li key={i}>{(t.setup as Record<string, string>)[i] ?? i}</li>
              ))}
            </ul>
          </div>
        )}
        <label className="mt-4 block">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted">{t.login.password}</span>
          <input
            type="password"
            autoComplete="current-password"
            autoFocus
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            className="mt-1 h-11 w-full rounded-lg border border-line bg-surface px-3 text-base focus:border-accent"
          />
        </label>
        {err && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {err}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={!pw || busy} className="mt-4 w-full justify-center">
          {t.login.submit}
        </Button>
      </form>
    </div>
  );
}

export function Toast({ message }: { message: string | null }) {
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-50 flex justify-center px-4">
      {message && <div className="fade-in rounded-full bg-ink px-4 py-2 text-sm text-bg shadow-lg">{message}</div>}
    </div>
  );
}
