import { App } from "@/components/App";
import { DEFAULT_MODEL } from "@/lib/server/env";
import { LIMITS } from "@/lib/shared/options";

export const dynamic = "force-static";

export default function Page() {
  // Only the configured model *name* reaches the client (for the footer); never keys or other env.
  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  return <App modelName={model} maxChars={LIMITS.maxInputChars} />;
}
