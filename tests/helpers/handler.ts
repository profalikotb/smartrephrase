import { createRephraseHandler, type HandlerDeps } from "@/lib/server/handler";
import { geminiProvider } from "@/lib/server/gemini";
import { getConfig, type ServerConfig } from "@/lib/server/env";
import { MemoryLimiter, type LimiterState } from "@/lib/server/rate-limit";
import { DEFAULT_OPTIONS, type RephraseRequest } from "@/lib/shared/options";
import { NdjsonParser, type StreamEvent } from "@/lib/shared/protocol";
import { mockGeminiFetch, type MockCall, type Step } from "./mock-gemini";

export const FAST = { firstContentMs: 150, inactivityMs: 120, overallMs: 600 };

export function makeHandler(opts: {
  plan?: Parameters<typeof mockGeminiFetch>[0];
  env?: Record<string, string | undefined>;
  limiter?: LimiterState;
  calls?: MockCall[];
  logs?: Record<string, unknown>[];
  timeouts?: Partial<typeof FAST>;
}) {
  const calls = opts.calls ?? [];
  const f = mockGeminiFetch(opts.plan ?? { steps: [] }, calls);
  const cfg: ServerConfig = getConfig({ NODE_ENV: "test", GEMINI_API_KEY: "test-key", ...opts.env } as NodeJS.ProcessEnv);
  const deps: HandlerDeps = {
    provider: (req) => geminiProvider({ ...req, fetchImpl: f }),
    getConfig: () => cfg,
    getLimiter: () => opts.limiter ?? { kind: "ready", limiter: new MemoryLimiter(1000) },
    now: Date.now,
    log: (e) => opts.logs?.push(e),
    timeouts: { ...FAST, ...opts.timeouts },
  };
  return { handler: createRephraseHandler(deps), calls };
}

export function body(over: Partial<RephraseRequest> = {}): RephraseRequest {
  return { text: "This is a test.", options: { ...DEFAULT_OPTIONS }, variant: "single", attempt: 0, useFallback: false, budgetMs: 45_000, uiLang: "en", ...over };
}

export function req(b: unknown, init: { headers?: Record<string, string>; signal?: AbortSignal; raw?: string } = {}): Request {
  return new Request("https://app.test/api/rephrase", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://app.test", "sec-fetch-site": "same-origin", ...init.headers },
    body: init.raw ?? JSON.stringify(b),
    signal: init.signal,
  });
}

export async function readEvents(res: Response): Promise<StreamEvent[]> {
  const p = new NdjsonParser();
  const out: StreamEvent[] = [];
  const reader = res.body!.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(...p.push(value));
  }
  out.push(...p.end());
  return out;
}

export type { Step };
