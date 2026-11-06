import { defineConfig } from "vite-plus";

import runConfig from "../../run.config.ts";

export default defineConfig({
  run: {
    tasks: {
      "bench:codemode": {
        cache: false,
        command: "node --conditions=source --experimental-strip-types test/codemode-bench.ts",
      },
      "bench:document-append": {
        cache: false,
        command:
          "node --conditions=source --experimental-strip-types test/document-append-bench.ts",
      },
      "bench:document-cache": {
        cache: false,
        command:
          "node --conditions=source --experimental-strip-types test/session-document-cache-bench.ts",
      },
      "bench:nested-images": {
        cache: false,
        command:
          "node --conditions=source --experimental-strip-types --expose-gc test/nested-images-bench.ts",
      },
      "bench:nested-tools": {
        cache: false,
        command:
          "node --conditions=source --experimental-strip-types --expose-gc test/nested-tools-bench.ts",
      },
      "bench:scheduler-fanout": {
        cache: false,
        command:
          "node --conditions=source --experimental-strip-types test/scheduler-fanout-bench.ts",
      },
      "bench:scheduler-memory": {
        cache: false,
        command:
          "node --conditions=source --experimental-strip-types test/scheduler-memory-bench.ts",
      },
      "bench:storage": {
        cache: false,
        command: "vitest bench --config vitest.benchmark.config.ts",
      },
      "bench:storage:memory": {
        cache: false,
        command: "node --conditions=source --experimental-strip-types test/storage-memory.ts",
      },
      "bench:tool-output": {
        cache: false,
        command:
          "node --conditions=source --experimental-strip-types --expose-gc test/tool-output-bench.ts",
      },
      build: runConfig.libBuild,
    },
  },
});
