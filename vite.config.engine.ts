import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    plugins: ["oxc", "import", "promise", "node"],
    categories: {
      correctness: "error",
      suspicious: "error",
    },
    ignorePatterns: [
      "**/dist/**",
      "**/models.generated.ts",
      "**/*.models.ts",
      "packages/ai/src/providers/data/**",
    ],
    options: {
      denyWarnings: false,
    },
  },
});
