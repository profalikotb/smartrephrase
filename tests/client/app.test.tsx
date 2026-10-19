// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "@/components/App";
import { mockApi, start, delta, done, type ApiCall, type ApiPlan } from "../helpers/mock-api";

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, onchange: null, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

let calls: ApiCall[];
function installFetch(plans: ApiPlan[]) {
  calls = [];
  const api = mockApi(plans, calls);
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    if (String(url).includes("/api/auth/session")) return Promise.resolve(new Response(JSON.stringify({ required: false, authenticated: true, configured: true }), { headers: { "content-type": "application/json" } }));
    return api(url, init);
  });
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("sr:prefs:v1", JSON.stringify({ uiLang: "en" }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const editor = () => screen.getByRole("textbox", { name: "Original text" }) as HTMLTextAreaElement;
const rephraseBtn = () => screen.getByRole("button", { name: /^Rephrase$/ });

describe("App", () => {
  it("streams a result, keeps input, and ties the result to the input", async () => {
    installFetch([{ kind: "stream", steps: [start, delta("The patient "), { wait: 10 }, delta("has no fever."), done()] }]);
    render(<App modelName="gemini-3.5-flash-lite" maxChars={8000} />);
    fireEvent.change(editor(), { target: { value: "patient no fever" } });
    fireEvent.click(rephraseBtn());
    await screen.findByText("The patient has no fever.");
    expect(editor().value).toBe("patient no fever");
    expect(calls).toHaveLength(1);
    fireEvent.change(editor(), { target: { value: "patient no fever!" } });
    expect(screen.getByText(/original changed after this result/i)).toBeTruthy();
  });

  it("changing settings never triggers a request", async () => {
    installFetch([{ kind: "stream", steps: [start, delta("x"), done()] }]);
    render(<App modelName="m" maxChars={8000} />);
    fireEvent.change(editor(), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("radio", { name: "Shorten" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Style" }), { target: { value: "medical" } });
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toHaveLength(0);
  });

  it("repeated clicks cannot start conflicting requests; Stop cancels and late output is ignored", async () => {
    installFetch([{ kind: "stream", delay: 80, steps: [start, delta("LATE"), done()] }]);
    render(<App modelName="m" maxChars={8000} />);
    fireEvent.change(editor(), { target: { value: "hello" } });
    fireEvent.click(rephraseBtn());
    expect(screen.queryByRole("button", { name: /^Rephrase$/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(screen.getAllByText("Stopped").length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 150));
    expect(screen.queryByText("LATE")).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.aborted()).toBe(true);
    expect(editor().value).toBe("hello");
  });

  it("over-limit input is never truncated and blocks submission", () => {
    installFetch([]);
    render(<App modelName="m" maxChars={10} />);
    fireEvent.change(editor(), { target: { value: "12345678901234" } });
    expect(editor().value).toBe("12345678901234");
    expect(screen.getByRole("alert").textContent).toMatch(/Over the limit by 4/);
    expect((rephraseBtn() as HTMLButtonElement).disabled).toBe(true);
  });

  it("switching interface language flips document direction; editor direction follows its own text", async () => {
    installFetch([]);
    render(<App modelName="m" maxChars={8000} />);
    await waitFor(() => expect(document.documentElement.dir).toBe("ltr"));
    fireEvent.change(editor(), { target: { value: "المريض لا يعاني من صداع" } });
    expect(editor().dir).toBe("rtl");
    fireEvent.click(screen.getByRole("button", { name: "Interface language" }));
    await waitFor(() => expect(document.documentElement.dir).toBe("rtl"));
    expect(screen.getByRole("button", { name: "إعادة صياغة" })).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "النص الأصلي" }), { target: { value: "Plain English text" } });
    expect((screen.getByRole("textbox", { name: "النص الأصلي" }) as HTMLTextAreaElement).dir).toBe("ltr");
  });

  it("server failure keeps the input and shows a localized, actionable error with Retry", async () => {
    installFetch([{ kind: "json", status: 429, body: { error: { code: "quota_exhausted", retryable: false } } }]);
    render(<App modelName="m" maxChars={8000} />);
    fireEvent.change(editor(), { target: { value: "keep me" } });
    fireEvent.click(rephraseBtn());
    await screen.findByText(/quota for this key is used up/i);
    expect(editor().value).toBe("keep me");
  });

  it("partial output after a mid-stream failure is labelled incomplete", async () => {
    installFetch([{ kind: "stream", steps: [start, delta("Half a sen"), { wait: 10 }, { ev: { type: "error", error: { code: "timeout_inactivity", retryable: false } } }] }]);
    render(<App modelName="m" maxChars={8000} />);
    fireEvent.change(editor(), { target: { value: "x" } });
    fireEvent.click(rephraseBtn());
    await screen.findByText(/Incomplete result/);
    expect(screen.getByText("Half a sen")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Restart" })).toBeTruthy();
  });

  it("offline: editing works and no request is sent", async () => {
    installFetch([]);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<App modelName="m" maxChars={8000} />);
    fireEvent.change(editor(), { target: { value: "draft" } });
    await act(async () => {
      fireEvent.click(rephraseBtn());
    });
    expect(await screen.findAllByText(/offline/i)).not.toHaveLength(0);
    expect(calls).toHaveLength(0);
    expect(editor().value).toBe("draft");
  });

  it("result text is rendered as text, never HTML", async () => {
    installFetch([{ kind: "stream", steps: [start, delta('<img src=x onerror="alert(1)"> <b>bold</b>'), done()] }]);
    render(<App modelName="m" maxChars={8000} />);
    fireEvent.change(editor(), { target: { value: "x" } });
    fireEvent.click(rephraseBtn());
    await screen.findByText(/onerror/);
    expect(document.querySelector("img[src=x]")).toBeNull();
    expect(document.querySelector("b")).toBeNull();
  });
});
