/** Analysis behavior suites use isolated workers so mutation tests cannot leak shared defaults. */
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["test/analysis/**/*.test.ts"], maxWorkers: 2 },
});
