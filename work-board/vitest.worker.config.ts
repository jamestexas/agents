import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/worker.ts",
      miniflare: {
        compatibilityDate: "2026-03-01",
        bindings: { WORK_BOARD_FIXTURE: "true" }
      }
    })
  ],
  test: { include: ["test/worker/**/*.test.ts"] }
});
