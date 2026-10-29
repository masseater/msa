import { defineConfig } from "vite-plus";

import runConfig from "../../run.config.ts";

export default defineConfig({ run: { tasks: { build: runConfig.libBuild } } });
