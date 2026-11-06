import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      clean: { cache: false, command: "shx rm -rf .eval" },
      eval: {
        cache: false,
        command: [
          "vitest run --config vitest.evals.config.ts --project host",
          "node --experimental-strip-types src/cli.ts",
        ],
      },
      "eval:docs": { cache: false, command: "node --experimental-strip-types src/cli.ts" },
      "eval:host": {
        cache: false,
        command: "vitest run --config vitest.evals.config.ts --project host",
      },
    },
  },
});
