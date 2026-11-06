import { defineConfig } from "vite-plus";

import runConfig from "../../run.config.ts";

const modelData = ["src/providers/data/**"];
const modelSources = ["src/models.generated.ts", "src/providers/*.models.ts", ...modelData];

const generatorInputs = [
  "package.json",
  "scripts/**",
  "src/**",
  ...modelSources.map((pattern) => `!${pattern}`),
  "!src/providers/.model-generation-*/**",
  { base: "workspace" as const, pattern: "pnpm-lock.yaml" },
];

export default defineConfig({
  pack: {
    banner: "#!/usr/bin/env node",
    dts: false,
    entry: { "msa-ai": "src/cli.ts" },
    outDir: "dist/bin",
  },
  run: {
    tasks: {
      build: { cache: false, command: ["vp run generate-models", "vp run build:offline"] },
      "build:offline": {
        cache: {
          input: runConfig.libSources,
          output: ["dist/**"],
        },
        command: [
          "tsc -p tsconfig.build.json",
          "shx rm -rf dist/providers/data",
          "shx cp -r src/providers/data dist/providers/data",
          "vp pack",
        ],
      },
      "generate-model-catalog": {
        cache: false,
        command:
          "node scripts/generate-models.ts --strict --json-only --json-output ../../.artifacts/model-catalog",
      },
      "generate-models": {
        cache: { input: generatorInputs, output: modelSources },
        command: "node scripts/generate-models.ts --strict",
      },
      "hydrate-model-data": {
        cache: { input: generatorInputs, output: modelData },
        command: "node scripts/generate-models.ts --strict --data-only",
      },
    },
  },
});
