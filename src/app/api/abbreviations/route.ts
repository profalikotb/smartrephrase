import { createAbbreviationHandlers } from "@/lib/server/abbreviations-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { GET, POST } = createAbbreviationHandlers();
