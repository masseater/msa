import { fileURLToPath } from "node:url";

import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import platform from "../fixtures/platform.ts";

const { runNode } = platform;

const validatesRetention = (scenario: string) =>
  Effect.gen(function* () {
    const child = yield* runNode(
      ["--expose-gc", fileURLToPath(new URL("./retention.worker.ts", import.meta.url)), scenario],
      { timeout: "60 seconds" },
    );
    expect(child.status, `${child.stdout}\n${child.stderr}`).toBe(0);
  });

describe("delta tracker retention across GC jobs", () => {
  it.each([
    "aborted-payload",
    "unadopted-prepared",
    "draft-proxies",
    "settled-lifecycle",
    "obsolete-revisions",
    "retained-settled-prepared",
    "retained-settled-change",
    "retained-settled-proxy",
    "retained-large-settled-proxy",
    "retained-large-placement-proxies",
    "stale-unprepared-change",
    "same-job-fast-cleanup",
    "same-job-folded-ops-cleanup",
    "lifecycle-churn",
  ])(
    "validates %s retention semantics",
    (scenario) => Effect.runPromise(validatesRetention(scenario)),
    65_000,
  );
});
