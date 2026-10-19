"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/** Advisory only — "online" does not prove the AI service is reachable. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine !== false, () => true);
}

/** Tracks the *visual* viewport so the action bar stays above the iOS on-screen keyboard. */
export function useVisualViewport(): boolean {
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        document.documentElement.style.setProperty("--vvh", `${Math.round(vv.height)}px`);
        setKeyboard(vv.height < window.innerHeight * 0.78 && window.matchMedia("(pointer: coarse)").matches);
        // iOS scrolls the layout viewport when the keyboard opens; pin it back.
        if (vv.offsetTop > 0 && window.matchMedia("(pointer: coarse)").matches) window.scrollTo(0, 0);
      });
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return keyboard;
}

export function useMediaQuery(q: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(q);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(q).matches,
    () => false,
  );
}

/** Ticks once per second while `active`, for an honest elapsed-time indicator (no fake progress). */
export function useElapsed(since: number | undefined, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return active && since ? Math.max(0, Math.floor((now - since) / 1000)) : 0;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** dd/MM/yyyy hh:mm AM/PM */
export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours();
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(h % 12 || 12)}:${pad(d.getMinutes())} ${h < 12 ? "AM" : "PM"}`;
}

export function fileStamp(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours();
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}_${pad(h % 12 || 12)}-${pad(d.getMinutes())}${h < 12 ? "AM" : "PM"}`;
}
