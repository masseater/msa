import { defineConfig } from "vite-plus";

const evalConfig = defineConfig({
  test: {
    fileParallelism: false,
    maxWorkers: 1,
    passWithNoTests: false,
    pool: "forks",
    projects: [
      {
        extends: true,
        test: {
          hookTimeout: 300_000,
          include: ["evals/**/*.docs.eval.ts"],
          name: "docs",
          sequence: { concurrent: false },
          testTimeout: 300_000,
        },
      },
      {
        extends: true,
        test: {
          exclude: ["evals/**/*.docs.eval.ts"],
          hookTimeout: 300_000,
          include: ["evals/**/*.eval.ts"],
          name: "host",
          sequence: { concurrent: false },
          testTimeout: 300_000,
        },
      },
    ],
    watch: false,
  },
});

const vitestEvals = {
  evalConfig,
};

export default vitestEvals;
