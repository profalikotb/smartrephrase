import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src"), "server-only": path.resolve(import.meta.dirname, "tests/helpers/server-only.ts") } },
  test: {
    globals: true,
    include: ["tests/unit/**/*.test.ts", "tests/server/**/*.test.ts", "tests/client/**/*.test.{ts,tsx}"],
    environment: "node",
    restoreMocks: true,
  },
});
