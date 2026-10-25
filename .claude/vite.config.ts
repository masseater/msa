import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      fallow: {
        cache: {
          input: [
            { auto: true },
            "!.fallow/**",
            { base: "workspace", pattern: "!node_modules/.pnpm/@fallow-cli+*/**/.fallow-verified" },
          ],
          output: [],
        },
        command:
          "fallow --skip dupes --fail-on-issues --quiet --format compact && fallow dupes --fail-on-issues --quiet --format compact && fallow security --fail-on-issues --quiet",
      },
    },
  },
});
