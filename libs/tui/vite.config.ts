import { defineConfig } from "vite-plus";

import runConfig from "../../run.config.ts";

export default defineConfig({
  run: {
    tasks: {
      build: runConfig.libBuild,
      "build:native:darwin": { cache: false, command: "native/darwin/build.sh" },
      "build:native:linux": { cache: false, command: "native/linux/build.sh" },
      "build:native:win32": { cache: false, command: "node native/win32/build.ts" },
    },
  },
});
