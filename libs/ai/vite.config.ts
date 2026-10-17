import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: { "msa-ai": "src/cli.ts" },
    outDir: "dist/bin",
    banner: "#!/usr/bin/env node",
    dts: false,
  },
});
