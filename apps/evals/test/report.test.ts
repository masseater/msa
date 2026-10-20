import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type planTypes from "../src/plan.types.ts";
import platform from "../src/platform.ts";
import reportRead from "../src/report-read.ts";
import reportTypes from "../src/report-types.ts";

const { files, pathOperations } = platform;
const { MSA_SESSION_SNAPSHOT_ARTIFACT } = reportTypes;
const { classifyCaseStatus, readTaskObservation } = reportRead;

const temporaryDirectories: string[] = [];
afterEach(() =>
  Effect.runPromise(
    Effect.forEach(temporaryDirectories.splice(0), files.remove, { discard: true }),
  ),
);

const run = (effect: Effect.Effect<void>) => Effect.runPromise(effect);

const task: planTypes.EvalTask = {
  caseId: "handles the case",
  evalSet: "Example workflow",
  file: "evals/example.docs.eval.ts",
  fullName: "Example workflow > handles the case",
  model: "fixture/model",
  runNumber: 1,
  variant: "without_docs",
};
const SESSION = '{"type":"session"}\n';

type ReportAssertion = {
  status?: "passed" | "skipped" | "pending" | "failed";
  meta?: Record<string, unknown>;
};

function reportJson(assertion: ReportAssertion): string {
  const status = assertion.status ?? "passed";
  return JSON.stringify({
    numFailedTests: 0,
    numPassedTests: status === "passed" ? 1 : 0,
    numPendingTests: status === "pending" || status === "skipped" ? 1 : 0,
    numTodoTests: 0,
    numTotalTests: 1,
    startTime: 0,
    success: true,
    testResults: [
      {
        assertionResults: [
          {
            ancestorTitles: [task.evalSet],
            failureMessages: [],
            fullName: `${task.evalSet} ${task.caseId}`,
            meta: assertion.meta ?? {},
            status,
            title: task.caseId,
          },
        ],
        message: "",
        name: "/repo/apps/evals/evals/example.docs.eval.ts",
        status: "passed",
      },
    ],
  });
}

const writeTaskReport = (assertion: ReportAssertion = {}) =>
  Effect.gen(function* () {
    const directory = yield* files.makeTempDirectory("msa-eval-report-test-");
    temporaryDirectories.push(directory);
    const reportPath = pathOperations.join(directory, "vitest.json");
    yield* files.writeFileString(reportPath, reportJson(assertion));
    return { directory, reportPath };
  });

function scoredMeta(overrides?: {
  avgScore?: number | null;
  model?: string;
  errors?: Array<Record<string, string>>;
  artifacts?: Record<string, string>;
}): Record<string, unknown> {
  return {
    eval: {
      avgScore: overrides !== undefined && "avgScore" in overrides ? overrides.avgScore : 0.5,
      scores: [{ name: "StructuredOutputJudge", score: 0.5 }],
      thresholdFailed: false,
    },
    harness: {
      name: "without_docs",
      run: {
        artifacts: overrides?.artifacts ?? {
          runId: "run-1",
          [MSA_SESSION_SNAPSHOT_ARTIFACT]: SESSION,
        },
        errors: overrides?.errors ?? [],
        output: { ok: true },
        session: { events: [{ content: "prompt", role: "user", type: "message" }] },
        timings: { totalMs: 1234 },
        usage: {
          inputTokens: 10,
          metadata: { cacheReadTokens: 2, cacheWriteTokens: 3, estimatedCostUsd: 0.01 },
          model: overrides?.model ?? "model",
          outputTokens: 5,
          provider: "fixture",
          toolCalls: 1,
          totalTokens: 15,
        },
      },
    },
  };
}

const readObservation = (assertion?: ReportAssertion) =>
  Effect.gen(function* () {
    const { directory, reportPath } = yield* writeTaskReport(assertion);
    const observation = yield* readTaskObservation({
      artifactDirectory: directory,
      reportPath,
      task,
    });
    return { directory, observation };
  });

const persistedSession = (directory: string) =>
  Effect.gen(function* () {
    const sessions = pathOperations.join(directory, task.variant, "sessions");
    const hashes = yield* files.readDirectory(sessions);
    const [hash] = hashes;
    if (hash === undefined)
      return yield* Effect.die(new Error("Expected a persisted session directory."));
    return {
      content: yield* files.readFileString(pathOperations.join(sessions, hash, "session.jsonl")),
      count: hashes.length,
    };
  });

const expectedIdentity = {
  caseId: task.caseId,
  evalSet: task.evalSet,
  model: task.model,
  runNumber: task.runNumber,
  variant: task.variant,
};

const expectedMetrics = {
  cacheReadTokens: 2,
  cacheWriteTokens: 3,
  estimatedCostUsd: 0.01,
  inputTokens: 10,
  outputTokens: 5,
  toolCalls: 1,
  totalMs: 1234,
  totalTokens: 15,
};

describe("classifyCaseStatus", () => {
  it.each(["skipped", "todo", "disabled"] as const)("maps %s to skipped", (status) => {
    expect(classifyCaseStatus(status)).toBe("skipped");
  });

  it("maps failed infrastructure to errored", () => {
    expect(classifyCaseStatus("failed")).toBe("errored");
  });
});

describe("readTaskObservation without a harness run", () => {
  it("preserves a skipped outcome when no harness run exists", () =>
    run(
      Effect.gen(function* () {
        const { observation } = yield* readObservation({ status: "skipped" });
        expect(observation).toMatchObject({ outcome: "skipped" });
      }),
    ));

  it("preserves a pending outcome when no harness run exists", () =>
    run(
      Effect.gen(function* () {
        const { observation } = yield* readObservation({ status: "pending" });
        expect(observation).toMatchObject({ outcome: "pending" });
      }),
    ));

  it("records an errored outcome when a passed eval has no harness run", () =>
    run(
      Effect.gen(function* () {
        const { observation } = yield* readObservation({ status: "passed" });
        expect(observation).toMatchObject({ outcome: "errored" });
      }),
    ));
});

describe("readTaskObservation with a harness run", () => {
  it("preserves metrics from a failed eval with a partial harness run", () =>
    run(
      Effect.gen(function* () {
        const { directory, observation } = yield* readObservation({
          meta: scoredMeta({ errors: [{ message: "Prompt verification failed" }] }),
          status: "failed",
        });
        expect(observation).toEqual({
          ...expectedIdentity,
          outcome: "errored",
          ...expectedMetrics,
        });
        expect((yield* persistedSession(directory)).content).toBe(SESSION);
      }),
    ));

  it("reads a scored harness run and persists the session artifact", () =>
    run(
      Effect.gen(function* () {
        const { directory, observation } = yield* readObservation({ meta: scoredMeta() });
        expect(observation).toEqual({
          ...expectedIdentity,
          outcome: "scored",
          score: 0.5,
          ...expectedMetrics,
        });
        const session = yield* persistedSession(directory);
        expect(session.count).toBe(1);
        expect(session.content).toBe(SESSION);
      }),
    ));

  it("treats a zero score as scored data", () =>
    run(
      Effect.gen(function* () {
        const { observation } = yield* readObservation({ meta: scoredMeta({ avgScore: 0 }) });
        expect(observation).toMatchObject({ outcome: "scored", score: 0 });
      }),
    ));

  it("records an unscored outcome when a completed eval has no score", () =>
    run(
      Effect.gen(function* () {
        const { observation } = yield* readObservation({ meta: scoredMeta({ avgScore: null }) });
        expect(observation).toMatchObject({ outcome: "unscored" });
      }),
    ));
});

describe("readTaskObservation validation", () => {
  it("records an errored outcome when the reported model does not match the task", () =>
    run(
      Effect.gen(function* () {
        const { observation } = yield* readObservation({ meta: scoredMeta({ model: "other" }) });
        expect(observation).toMatchObject({ outcome: "errored" });
      }),
    ));

  it("records an errored outcome when a completed harness run contains errors", () =>
    run(
      Effect.gen(function* () {
        const { observation } = yield* readObservation({
          meta: scoredMeta({ errors: [{ message: "boom" }] }),
        });
        expect(observation).toMatchObject({ outcome: "errored" });
      }),
    ));

  it("still scores a completed eval when the session artifact is missing", () =>
    run(
      Effect.gen(function* () {
        const { observation } = yield* readObservation({
          meta: scoredMeta({ artifacts: { runId: "run-1" } }),
        });
        expect(observation).toMatchObject({ outcome: "scored", score: 0.5 });
      }),
    ));
});
