import "server-only";
import { GoogleGenAI, ThinkingLevel, type GenerateContentConfig, type GenerateContentResponse } from "@google/genai";
import type { BuiltPrompt } from "./prompt";
import type { ThinkingLevelName } from "./env";

export interface ProviderChunk {
  text: string;
  finishReason?: string;
  blockReason?: string;
  usage?: { input?: number; output?: number };
}

export interface ProviderRequest {
  apiKey: string;
  model: string;
  prompt: BuiltPrompt;
  signal: AbortSignal;
  thinkingLevel?: ThinkingLevelName;
  temperature?: number;
  /** Test seam: inject a fetch implementation (the real SDK is still exercised end-to-end). */
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

export type Provider = (req: ProviderRequest) => Promise<AsyncIterable<ProviderChunk>>;

const LEVEL: Record<ThinkingLevelName, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

/**
 * Gemini adapter (GenerateContent streaming — stateless, nothing stored as an interaction resource).
 * - SDK HTTP retries are disabled (attempts: 1); the client owns the retry policy so attempts never multiply.
 * - SDK automatic stream continuation is disabled so a dropped stream is never silently resumed/concatenated.
 * - The AbortSignal is passed to the SDK, which forwards it to fetch: aborting tears down the socket.
 */
export const geminiProvider: Provider = async (req) => {
  const ai = new GoogleGenAI({
    apiKey: req.apiKey,
    httpOptions: {
      retryOptions: { attempts: 1 },
      ...(req.baseUrl ? { baseUrl: req.baseUrl } : {}),
      ...(req.fetchImpl ? { fetch: req.fetchImpl } : {}),
    },
  });

  const config: GenerateContentConfig = {
    systemInstruction: req.prompt.systemInstruction,
    maxOutputTokens: req.prompt.maxOutputTokens,
    candidateCount: 1,
    abortSignal: req.signal,
    automaticContinuation: false,
    responseMimeType: "text/plain",
    ...(req.thinkingLevel ? { thinkingConfig: { thinkingLevel: LEVEL[req.thinkingLevel], includeThoughts: false } } : {}),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
  };

  const stream = await ai.models.generateContentStream({
    model: req.model,
    contents: [{ role: "user", parts: [{ text: req.prompt.contents }] }],
    config,
  });

  return normalize(stream);
};

async function* normalize(stream: AsyncIterable<GenerateContentResponse>): AsyncGenerator<ProviderChunk> {
  for await (const r of stream) {
    const cand = r.candidates?.[0];
    const text = (cand?.content?.parts ?? [])
      .filter((p) => !p.thought && typeof p.text === "string")
      .map((p) => p.text as string)
      .join("");
    yield {
      text,
      finishReason: cand?.finishReason ?? undefined,
      blockReason: r.promptFeedback?.blockReason ?? undefined,
      usage: r.usageMetadata ? { input: r.usageMetadata.promptTokenCount, output: r.usageMetadata.candidatesTokenCount } : undefined,
    };
  }
}
