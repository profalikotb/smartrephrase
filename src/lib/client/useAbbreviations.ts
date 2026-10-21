"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_ABBREVIATIONS, sortAbbreviations, toMap, type AbbrMap, type AbbrOp, type Abbreviation } from "@/lib/shared/abbreviations";

/** cloud = Upstash Redis (synced across devices) · device = this browser only. */
export type AbbrStorage = "loading" | "cloud" | "server-memory" | "device";

const CACHE = "sr:abbr:v1";

function readCache(): Abbreviation[] | null {
  try {
    const raw = localStorage.getItem(CACHE);
    if (!raw) return null;
    const v = JSON.parse(raw) as { entries?: Abbreviation[] };
    return Array.isArray(v.entries) ? v.entries.filter((e) => typeof e?.key === "string" && typeof e?.text === "string") : null;
  } catch {
    return null;
  }
}
function writeCache(entries: Abbreviation[]) {
  try {
    localStorage.setItem(CACHE, JSON.stringify({ entries, savedAt: Date.now() }));
  } catch {
    /* storage blocked: still works in memory */
  }
}

function applyLocal(list: Abbreviation[], op: AbbrOp): Abbreviation[] {
  const m = new Map(list.map((a) => [a.key, a.text]));
  switch (op.op) {
    case "upsert":
      if (op.previousKey && op.previousKey.toUpperCase() !== op.key.toUpperCase()) m.delete(op.previousKey.toUpperCase());
      m.set(op.key.toUpperCase(), op.text.replace(/\s+/g, " ").trim());
      break;
    case "delete":
      m.delete(op.key.toUpperCase());
      break;
    case "import":
      for (const e of op.entries) if (op.overwrite || !m.has(e.key.toUpperCase())) m.set(e.key.toUpperCase(), e.text.replace(/\s+/g, " ").trim());
      break;
    case "restore_defaults":
      for (const e of DEFAULT_ABBREVIATIONS) if (!m.has(e.key)) m.set(e.key, e.text);
      break;
  }
  return sortAbbreviations([...m].map(([key, text]) => ({ key, text })));
}

export interface UseAbbreviations {
  entries: Abbreviation[];
  map: AbbrMap;
  storage: AbbrStorage;
  reload: () => Promise<void>;
  /** Resolves true on success. On a cloud failure the list is rolled back. */
  mutate: (op: AbbrOp) => Promise<{ ok: boolean; code?: string }>;
}

export function useAbbreviations(enabled: boolean): UseAbbreviations {
  const [entries, setEntries] = useState<Abbreviation[]>(DEFAULT_ABBREVIATIONS);
  const [storage, setStorage] = useState<AbbrStorage>("loading");
  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const reload = useCallback(async () => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10_000);
    try {
      const r = await fetch("/api/abbreviations", { cache: "no-store", credentials: "same-origin", signal: ctl.signal });
      if (!r.ok) {
        // 401 → the login gate is shown; anything else → keep the cached list and edit on this device.
        if (r.status !== 401) setStorage("device");
        return;
      }
      const j = (await r.json()) as { storage: AbbrStorage; entries: Abbreviation[] };
      if (j.storage === "device") {
        setStorage("device");
        return;
      }
      setEntries(sortAbbreviations(j.entries));
      writeCache(j.entries);
      setStorage(j.storage);
    } catch {
      setStorage((s) => (s === "loading" ? "device" : s));
    } finally {
      clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    const cached = readCache();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from the device cache before the network answers
    if (cached) setEntries(sortAbbreviations(cached));
    if (enabled) void reload();
  }, [enabled, reload]);

  const mutate = useCallback(
    async (op: AbbrOp) => {
      const before = entriesRef.current;
      const optimistic = applyLocal(before, op);
      setEntries(optimistic);
      writeCache(optimistic);
      if (storage === "device" || storage === "loading") return { ok: true };
      try {
        const r = await fetch("/api/abbreviations", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(op) });
        const j = (await r.json().catch(() => ({}))) as { entries?: Abbreviation[]; error?: { code?: string } };
        if (!r.ok || !j.entries) throw new Error(j.error?.code ?? "storage_error");
        const fresh = sortAbbreviations(j.entries);
        setEntries(fresh);
        writeCache(fresh);
        return { ok: true };
      } catch (e) {
        setEntries(before);
        writeCache(before);
        return { ok: false, code: e instanceof Error ? e.message : "storage_error" };
      }
    },
    [storage],
  );

  const map = useMemo(() => toMap(entries), [entries]);
  return { entries, map, storage, reload, mutate };
}
