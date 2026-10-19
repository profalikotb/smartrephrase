"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { requestFingerprint, type RewriteOptions, type Variant } from "@/lib/shared/options";
import { TIMEOUTS } from "@/lib/shared/timeouts";
import { IN_FLIGHT, initialState, reducer, type RephraseState } from "./state";
import { abortableSleep, runRephrase, type RunnerDeps } from "./runner";
import type { UiLang } from "./i18n";

function newOpId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const browserDeps = (): RunnerDeps => ({
  fetch: (...a) => fetch(...a),
  now: Date.now,
  sleep: abortableSleep,
  random: Math.random,
  isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine !== false),
});

export interface UseRephrase {
  state: RephraseState;
  start: (text: string, options: RewriteOptions, variant: Variant, uiLang: UiLang) => void;
  cancel: () => void;
  discardPartial: () => void;
  replaceResult: (r: RephraseState["result"]) => void;
  reset: () => void;
  inFlight: boolean;
}

export function useRephrase(depsFactory: () => RunnerDeps = browserDeps): UseRephrase {
  const [state, dispatch] = useReducer(reducer, initialState);
  const ctlRef = useRef<AbortController | null>(null);
  const opRef = useRef<string | null>(null);
  const bufRef = useRef("");
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hiddenAt = useRef<number | null>(null);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const depsRef = useRef<RunnerDeps | null>(null);

  const flush = useCallback(() => {
    if (flushTimer.current) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    const opId = opRef.current;
    if (opId && bufRef.current) {
      const text = bufRef.current;
      bufRef.current = "";
      dispatch({ type: "delta", opId, text });
    }
  }, []);

  const abortActive = useCallback(() => {
    flush();
    ctlRef.current?.abort(new DOMException("cancelled", "AbortError"));
    ctlRef.current = null;
  }, [flush]);

  const start = useCallback(
    (text: string, options: RewriteOptions, variant: Variant, uiLang: UiLang) => {
      // Supersede any running operation: its late events are ignored by opId.
      const prev = opRef.current;
      abortActive();
      if (prev) dispatch({ type: "cancel", opId: prev, at: Date.now() });
      const deps = (depsRef.current ??= depsFactory());
      const opId = newOpId();
      opRef.current = opId;
      bufRef.current = "";
      const ctl = new AbortController();
      ctlRef.current = ctl;
      dispatch({ type: "start", op: { opId, sourceText: text, options, variant, fingerprint: requestFingerprint(text, options, variant), startedAt: deps.now() } });

      void runRephrase({ text, options, variant, uiLang }, ctl.signal, (e) => {
        if (opRef.current !== opId) return;
        if (e.type === "delta") {
          bufRef.current += e.text;
          if (!flushTimer.current) flushTimer.current = setTimeout(flush, TIMEOUTS.renderFlushMs);
          return;
        }
        flush();
        const at = Date.now();
        switch (e.type) {
          case "connecting":
            dispatch({ type: "connecting", opId, attempt: e.attempt });
            break;
          case "retrying":
            dispatch({ type: "retrying", opId, attempt: e.attempt, delayMs: e.delayMs, code: e.code });
            break;
          case "generating":
            dispatch({ type: "generating", opId });
            break;
          case "completed":
            dispatch({ type: "completed", opId, finish: e.finish, model: e.model, at });
            ctlRef.current = null;
            break;
          case "failed":
            dispatch({ type: "failed", opId, code: e.code, retryAfter: e.retryAfter, at });
            ctlRef.current = null;
            break;
        }
      }, deps).catch(() => {
        if (opRef.current === opId) dispatch({ type: "failed", opId, code: "bad_response", at: Date.now() });
      });
    },
    [abortActive, depsFactory, flush],
  );

  const cancel = useCallback(() => {
    const opId = opRef.current;
    abortActive();
    if (opId) dispatch({ type: "cancel", opId, at: Date.now() });
  }, [abortActive]);

  const failActive = useCallback(
    (code: "offline" | "interrupted" | "timeout_overall") => {
      const opId = opRef.current;
      if (!opId || !IN_FLIGHT.has(stateRef.current.status)) return;
      abortActive();
      dispatch({ type: "failed", opId, code, at: Date.now() });
    },
    [abortActive],
  );

  // Lifecycle: offline, backgrounding, bfcache, navigation — never leave a permanent spinner.
  useEffect(() => {
    const onOffline = () => failActive("offline");
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt.current = Date.now();
        return;
      }
      const s = stateRef.current;
      const hiddenFor = hiddenAt.current ? Date.now() - hiddenAt.current : 0;
      hiddenAt.current = null;
      if (!IN_FLIGHT.has(s.status) || !s.op) return;
      if (Date.now() - s.op.startedAt > TIMEOUTS.overallMs) failActive("timeout_overall");
      else if (hiddenFor > TIMEOUTS.inactivityMs) failActive("interrupted");
    };
    const onPageHide = () => {
      if (IN_FLIGHT.has(stateRef.current.status)) failActive("interrupted");
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted && IN_FLIGHT.has(stateRef.current.status)) failActive("interrupted");
    };
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [failActive]);

  useEffect(
    () => () => {
      ctlRef.current?.abort();
      if (flushTimer.current) clearTimeout(flushTimer.current);
    },
    [],
  );

  return {
    state,
    start,
    cancel,
    discardPartial: useCallback(() => dispatch({ type: "discardPartial" }), []),
    replaceResult: useCallback((r) => dispatch({ type: "replaceResult", result: r }), []),
    reset: useCallback(() => {
      abortActive();
      opRef.current = null;
      dispatch({ type: "reset" });
    }, [abortActive]),
    inFlight: IN_FLIGHT.has(state.status),
  };
}
