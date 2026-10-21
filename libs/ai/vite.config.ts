import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    banner: "#!/usr/bin/env node",
    dts: false,
    entry: { "msa-ai": "src/cli.ts" },
    outDir: "dist/bin",
  },
});
