import { defineConfig } from "vite-plus";

const enginePaths = ["packages/**", "scripts/**"];
const generatedPaths = [
  "**/dist/**",
  "**/models.generated.ts",
  "**/*.models.ts",
  "packages/ai/src/providers/data/**",
];
const upstreamPaths = [
  ".github/**",
  ".pi/**",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "pi-test.bat",
  "pi-test.ps1",
  "pi-test.sh",
  "test.sh",
  "tsconfig.base.json",
  "tsconfig.json",
  "vitest.base.ts",
];

export default defineConfig({
  staged: { "*": "vp check --fix" },
  fmt: {
    ignorePatterns: [...upstreamPaths, ...enginePaths, ...generatedPaths, "pnpm-lock.yaml"],
    sortImports: true,
    sortPackageJson: true,
  },
  lint: {
    ignorePatterns: [...upstreamPaths, ...enginePaths, ...generatedPaths],
    plugins: ["oxc", "import", "promise", "node", "jsdoc"],
    categories: {
      correctness: "error",
      suspicious: "error",
      perf: "error",
      pedantic: "error",
      nursery: "error",
    },
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      { name: "no-comments", specifier: "eslint-plugin-no-comments" },
    ],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      "no-comments/disallowComments": ["error", { allow: ["oxlint-disable", "eslint-disable"] }],
      "eslint/no-duplicate-imports": ["error", { allowSeparateTypeImports: true }],
      "eslint/no-undef": "off",
      "eslint/one-var": ["error", "never"],
      "eslint/sort-imports": "off",
      "eslint/sort-keys": "off",
      "import/no-named-export": "off",
      "import/prefer-default-export": "off",
      "node/no-top-level-await": "off",
    },
    options: {
      denyWarnings: true,
      reportUnusedDisableDirectives: "error",
    },
  },
  run: {
    cache: true,
    tasks: {
      verify: {
        command: "vp check",
        dependsOn: ["engine-checks", "fence-check", "test-all"],
      },
      "engine-checks": {
        command:
          "node scripts/check-ts-relative-imports.mjs && node scripts/check-entry-graphs.mjs && node scripts/check-browser-smoke.mjs",
      },
      "fence-check": "node tools/fence-counts.mjs",
      "test-all": {
        command: "bash test.sh",
        cache: false,
      },
    },
  },
});
