/** Fake /api/rephrase for client-runner tests: scripted per attempt, honors AbortSignal like a real socket. */
export type ApiStep = { bytes: Uint8Array } | { wait: number } | { ev: Record<string, unknown> } | { stall: true } | { drop: true } | { rawLine: string };

export type ApiPlan =
  | { kind: "json"; status: number; body: unknown; headers?: Record<string, string>; delay?: number }
  | { kind: "stream"; steps: ApiStep[]; delay?: number }
  | { kind: "network-error"; delay?: number }
  | { kind: "hang" };

export interface ApiCall {
  body: Record<string, unknown>;
  aborted: () => boolean;
}

export function mockApi(plans: ApiPlan[], calls: ApiCall[] = []): typeof fetch {
  let i = 0;
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const plan = plans[Math.min(i++, plans.length - 1)]!;
    const signal = init?.signal ?? undefined;
    calls.push({ body: JSON.parse(String(init?.body)), aborted: () => Boolean(signal?.aborted) });
    const abortErr = () => new DOMException("aborted", "AbortError");
    const sleep = (ms: number) =>
      new Promise<void>((res, rej) => {
        if (signal?.aborted) return rej(abortErr());
        const t = setTimeout(res, ms);
        signal?.addEventListener("abort", () => (clearTimeout(t), rej(abortErr())), { once: true });
      });

    if ("delay" in plan && plan.delay) await sleep(plan.delay);
    if (plan.kind === "hang") {
      await sleep(10 * 60_000);
    }
    if (plan.kind === "network-error") throw new TypeError("Failed to fetch");
    if (plan.kind === "json")
      return new Response(JSON.stringify(plan.body), { status: plan.status, headers: { "content-type": "application/json", ...(plan.headers ?? {}) } });

    const enc = new TextEncoder();
    const steps = plan.kind === "stream" ? plan.steps : [];
    const stream = new ReadableStream<Uint8Array>({
      async start(ctrl) {
        signal?.addEventListener("abort", () => {
          try {
            ctrl.error(abortErr());
          } catch {
            /* closed */
          }
        }, { once: true });
        try {
          for (const s of steps) {
            if ("wait" in s) await sleep(s.wait);
            else if ("ev" in s) ctrl.enqueue(enc.encode(JSON.stringify(s.ev) + "\n"));
            else if ("bytes" in s) ctrl.enqueue(s.bytes);
            else if ("rawLine" in s) ctrl.enqueue(enc.encode(s.rawLine));
            else if ("stall" in s) await sleep(10 * 60_000);
            else if ("drop" in s) return ctrl.error(new TypeError("network error"));
          }
          ctrl.close();
        } catch {
          /* aborted */
        }
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "application/x-ndjson" } });
  }) as typeof fetch;
}

export const start = { ev: { type: "start", requestId: "r", model: "m" } };
export const delta = (text: string) => ({ ev: { type: "delta", text } });
export const done = (finish = "complete") => ({ ev: { type: "done", finish } });
export const err = (status: number, code: string, extra: Record<string, unknown> = {}) => ({ kind: "json" as const, status, body: { error: { code, retryable: true, ...extra } } });
