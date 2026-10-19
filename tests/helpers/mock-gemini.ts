/**
 * Deterministic fake of the Gemini REST endpoint, consumed by the *real* @google/genai SDK through
 * httpOptions.fetch. Honors AbortSignal exactly like a network socket would.
 */
export type Step =
  | { wait: number }
  | { data: Record<string, unknown> }
  | { raw: string }
  | { stall: true }
  | { drop: true };

export interface MockCall {
  url: string;
  body: Record<string, unknown>;
  aborted: () => boolean;
}

export function textChunk(text: string, finishReason?: string): Record<string, unknown> {
  return {
    candidates: [{ content: { role: "model", parts: [{ text }] }, ...(finishReason ? { finishReason } : {}), index: 0 }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
  };
}

export function mockGeminiFetch(
  plan: { status?: number; error?: Record<string, unknown>; headers?: Record<string, string>; steps?: Step[]; connectDelay?: number },
  calls: MockCall[] = [],
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal ?? undefined;
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url, body, aborted: () => Boolean(signal?.aborted) });

    const abortErr = () => (signal?.reason instanceof Error ? signal.reason : new DOMException("This operation was aborted", "AbortError"));
    const sleep = (ms: number) =>
      new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(abortErr());
        const t = setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(abortErr());
        }, { once: true });
      });

    if (plan.connectDelay) await sleep(plan.connectDelay);
    if (plan.status && plan.status >= 400) {
      return new Response(JSON.stringify(plan.error ?? { error: { code: plan.status, message: "err", status: "UNKNOWN" } }), {
        status: plan.status,
        headers: { "content-type": "application/json", ...(plan.headers ?? {}) },
      });
    }
    const enc = new TextEncoder();
    const steps = plan.steps ?? [];
    const stream = new ReadableStream<Uint8Array>({
      async start(ctrl) {
        const onAbort = () => {
          try {
            ctrl.error(abortErr());
          } catch {
            /* closed */
          }
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        try {
          for (const s of steps) {
            if ("wait" in s) await sleep(s.wait);
            else if ("data" in s) ctrl.enqueue(enc.encode(`data: ${JSON.stringify(s.data)}\r\n\r\n`));
            else if ("raw" in s) ctrl.enqueue(enc.encode(s.raw));
            else if ("stall" in s) await sleep(10 * 60_000);
            else if ("drop" in s) {
              ctrl.error(new TypeError("terminated"));
              return;
            }
          }
          ctrl.close();
        } catch {
          /* aborted: stream already errored */
        }
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
}
