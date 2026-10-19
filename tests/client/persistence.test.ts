// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PREFS, KEYS, addHistory, deleteSavedText, loadDraft, loadHistory, loadPrefs, saveDraft, savePrefs } from "@/lib/client/persistence";

beforeEach(() => localStorage.clear());
const allStored = () => Object.keys(localStorage).map((k) => localStorage.getItem(k)).join("|");

describe("local persistence", () => {
  it("persists nothing textual by default", () => {
    savePrefs(DEFAULT_PREFS);
    expect(saveDraft(DEFAULT_PREFS, "secret draft")).toBe(false);
    addHistory(DEFAULT_PREFS, { id: "1", createdAt: 0, source: "secret src", result: "secret out", options: DEFAULT_PREFS.options });
    expect(allStored()).not.toContain("secret");
    expect(localStorage.getItem(KEYS.draft)).toBeNull();
  });
  it("draft recovery works when explicitly enabled", () => {
    const p = { ...DEFAULT_PREFS, rememberDraft: true };
    savePrefs(p);
    saveDraft(p, "مسودة محفوظة");
    const loaded = loadPrefs();
    expect(loaded.rememberDraft).toBe(true);
    expect(loadDraft(loaded)).toBe("مسودة محفوظة");
  });
  it("private mode never persists text and ignores previously saved drafts", () => {
    const on = { ...DEFAULT_PREFS, rememberDraft: true };
    saveDraft(on, "old");
    const priv = { ...DEFAULT_PREFS, privateMode: true, rememberDraft: true, saveHistory: true, options: { ...DEFAULT_PREFS.options, preserveTerms: "Dr X", customInstructions: "personal" } };
    savePrefs(priv);
    expect(saveDraft(priv, "new secret")).toBe(false);
    expect(loadDraft(loadPrefs())).toBe("");
    expect(allStored()).not.toContain("new secret");
    expect(allStored()).not.toContain("Dr X");
  });
  it("history is bounded, local and deletable", () => {
    const p = { ...DEFAULT_PREFS, saveHistory: true };
    for (let i = 0; i < 25; i++) addHistory(p, { id: String(i), createdAt: i, source: `s${i}`, result: `r${i}`, options: p.options });
    expect(loadHistory(p)).toHaveLength(20);
    expect(loadHistory(p)[0]!.result).toBe("r24");
    saveDraft({ ...p, rememberDraft: true }, "draft");
    deleteSavedText();
    expect(loadHistory(p)).toHaveLength(0);
    expect(localStorage.getItem(KEYS.draft)).toBeNull();
  });
  it("corrupt or blocked storage never throws", () => {
    localStorage.setItem(KEYS.prefs, "{not json");
    expect(() => loadPrefs()).not.toThrow();
    localStorage.setItem(KEYS.prefs, JSON.stringify({ options: { style: "pirate", mode: "shorten" }, uiLang: "xx" }));
    const p = loadPrefs("en");
    expect(p.options.style).toBe("natural");
    expect(p.options.mode).toBe("shorten");
    expect(p.uiLang).toBe("en");
  });
});
