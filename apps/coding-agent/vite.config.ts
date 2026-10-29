import { defineConfig } from "vite-plus";

import runConfig from "../../run.config.ts";

const { libSources, workspace } = runConfig;

const outsideDist = {
  input: [
    ...libSources,
    "package.json",
    "src/**",
    "tsconfig.build.json",
    "tsconfig.json",
    workspace("scripts/**"),
    workspace("tools/class-seal/**"),
  ],
  output: ["dist/**"],
};

export default defineConfig({
  run: {
    tasks: {
      build: {
        cache: outsideDist,
        command: ["vp run build:unbundled", "node ../../scripts/build-coding-agent-bundle.ts"],
      },
      "build:unbundled": {
        cache: outsideDist,
        command: [
          "tsc -p tsconfig.build.json",
          "node ../../tools/class-seal/seal-dist.ts dist src",
          "shx chmod +x dist/cli.js dist/rpc-entry.js",
          "vp run copy-assets",
        ],
      },
      "copy-assets": {
        cache: outsideDist,
        command: [
          "shx mkdir -p dist/modes/interactive/theme",
          "shx cp src/modes/interactive/theme/*.json dist/modes/interactive/theme/",
          "shx mkdir -p dist/core/export-html/vendor",
          "shx cp src/core/export-html/template.html src/core/export-html/template.css src/core/export-html/template.js src/core/export-html/html-fragment.js dist/core/export-html/",
          "shx cp src/core/export-html/vendor/*.js dist/core/export-html/vendor/",
        ],
      },
    },
  },
});
