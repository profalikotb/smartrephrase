import { createRephraseHandler } from "@/lib/server/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Must exceed one attempt's server-side ceiling (TIMEOUTS.overallMs = 45 s). Next.js requires a literal here;
// tests assert it equals SERVER_MAX_DURATION_S.
export const maxDuration = 60;

export const POST = createRephraseHandler();
