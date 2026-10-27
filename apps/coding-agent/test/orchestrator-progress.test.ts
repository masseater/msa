import testing from "@msa/testing";
import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import orchestratorCallbacks from "../src/core/agent-session/orchestrator-callbacks.ts";
import goalChecksSupport from "./orchestrator-goal-checks-support.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import reviewVerdictSupport from "./review-verdict-support.ts";
import triageSupport from "./triage-support.ts";
import worktreeSupport from "./worktree-support.ts";

const { joinPath, writeTextFile } = testing;
const { escalateTriage } = triageSupport;
const { LINT_CHECK, withRepo } = goalChecksSupport;
const { create } = orchestratorSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus, waitFor } = harness;
const { classifierDecide, reportOf } = reviewVerdictSupport;
const { GIT_ROUNDS_TIMEOUT_MS, withRepository } = worktreeSupport;
const { runCommand } = orchestratorCallbacks;

type State = Parameters<typeof reportOf>[0];

const TURNS = 6;

const FINDING = "Within the goal: the second read is not covered by a test.";

const lintTask = (directory: string) =>
  Effect.gen(function* () {
    const setUp = setup({ cwd: directory, runCommand });
    const task = yield* create(setUp.orchestrator, {
      checks: [LINT_CHECK],
      currentState: "lint reports 3 errors",
      goalState: "lint reports 0 errors",
      title: "lint",
    });
    return { ...setUp, task };
  });

const keepsReturningChecksWhileTheFilesChange = (inGit: boolean) => () =>
  Effect.runPromise(
    (inGit ? withRepository : withRepo)((directory) =>
      Effect.gen(function* () {
        const { orchestrator, reports, task, workers } = yield* lintTask(directory);
        const worker = workers[0]!;
        const edited = joinPath(worker.cwd, inGit ? "app/README" : "src.txt");
        yield* writeTextFile(joinPath(worker.cwd, "lint.txt"), "3 errors\n");
        for (let turn = 1; turn <= TURNS; turn++) {
          yield* writeTextFile(edited, `attempt ${turn}\n`);
          worker.complete(`tried, attempt ${turn}`);
          yield* waitFor(() => worker.prompts.length === turn + 1);
          expect(worker.prompts[turn]).toContain("goal-checks-failed");
          expect(taskStatus(orchestrator, task.id)).toBe("running");
        }
        expect(reports).toEqual([]);

        worker.complete("tried again without touching a file");
        yield* escalateTriage(workers);
        yield* waitFor(() => taskStatus(orchestrator, task.id) === "needs-decision");
        expect(reports.at(-1)?.text).toContain("holds the same files");
      }),
    ),
  );

it(
  "returns failing checks with the same output to a worker that rewrites a file every turn outside git and without origin, and waits for a decision only after a turn that changes no file",
  keepsReturningChecksWhileTheFilesChange(false),
);

it(
  "returns failing checks with the same output to a worker that reworks a tracked file without committing, and waits for a decision only after a turn that changes no file",
  keepsReturningChecksWhileTheFilesChange(true),
  GIT_ROUNDS_TIMEOUT_MS,
);

function changesOf(state: State): string {
  const changes = state["changesSincePreviousReview"];
  return typeof changes === "string" ? changes : "";
}

const repeatingReviewer = (seen: State[]) =>
  classifierDecide({
    progress: (state) => {
      seen.push(state);
      return { moving: 0.1, stuck: 0.9 };
    },
    verdict: (state) =>
      reportOf(state).includes(FINDING) ? { fail: 0.9, pass: 0.1 } : { fail: 0.1, pass: 0.9 },
  });

const keepsSendingBackWhileTheFilesChange = (inGit: boolean) => () =>
  Effect.runPromise(
    (inGit ? withRepository : withRepo)((directory) =>
      Effect.gen(function* () {
        const seen: State[] = [];
        const { orchestrator, reports, workers } = setup({
          cwd: directory,
          decide: repeatingReviewer(seen),
        });
        const task = yield* create(orchestrator, {
          currentState: "repeated reads go to the network",
          goalState: "repeated reads hit the cache and a test covers the second read",
          title: "cache reads",
        });
        const edited = joinPath(workers[0]!.cwd, inGit ? "app/README" : "src.txt");
        workers[0]!.complete("added the cache");
        for (let round = 1; round <= TURNS; round++) {
          yield* waitFor(() => workers.length === 2 * round);
          workers.at(-1)!.complete(`Not acceptable.\n${FINDING}`);
          yield* waitFor(() => workers.length === 2 * round + 1);
          expect(taskStatus(orchestrator, task.id)).toBe("running");
          yield* writeTextFile(edited, `attempt ${round}\n`);
          workers.at(-1)!.complete(`reworked the test, attempt ${round}`);
        }
        expect(changesOf(seen.at(-1) ?? {})).toContain(inGit ? "+attempt" : "files changed");

        yield* waitFor(() => workers.length === 2 * TURNS + 2);
        workers.at(-1)!.complete(`Not acceptable.\n${FINDING}`);
        yield* waitFor(() => workers.length === 2 * TURNS + 3);
        workers.at(-1)!.complete("changed nothing");
        yield* waitFor(() => workers.length === 2 * TURNS + 4);
        workers.at(-1)!.complete(`Still not acceptable.\n${FINDING}`);
        yield* escalateTriage(workers);
        yield* waitFor(() => taskStatus(orchestrator, task.id) === "needs-decision");
        expect(changesOf(seen.at(-1) ?? {})).toBe("(no change to the working tree)");
        expect(reports.at(-1)?.text).toContain("the work is not moving");
      }),
    ),
  );

it(
  "keeps sending back a review that repeats its findings while the worker changes files outside git, and waits for a decision once a round changes nothing",
  keepsSendingBackWhileTheFilesChange(false),
);

it(
  "keeps sending back a review that repeats its findings while the worker reworks files without committing, and waits for a decision once a round changes nothing",
  keepsSendingBackWhileTheFilesChange(true),
  GIT_ROUNDS_TIMEOUT_MS,
);
