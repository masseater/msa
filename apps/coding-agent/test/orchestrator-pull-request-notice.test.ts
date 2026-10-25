import { Effect } from "effect";
import { afterEach, expect, it, vi } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import watchdogSupport from "./orchestrator-watchdog-support.ts";
import pullRequestSupport from "./pull-request-support.ts";
import worktreeSupport from "./worktree-support.ts";

const { create } = orchestratorSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus } = harness;
const { read, runCommand, shortId } = worktreeSupport;
const { commitAndPush, withRemote } = pullRequestSupport;
const { advance, fakeClock } = watchdogSupport;

afterEach(() => {
  vi.useRealTimers();
});

type Remote = Parameters<Parameters<typeof withRemote>[0]>[0];

function carryingAPullRequest(remote: Remote) {
  return Effect.gen(function* () {
    const { github, repository } = remote;
    const run = setup({ cwd: repository, runCommand, runGh: github.runGh });
    const task = yield* create(run.orchestrator, {
      currentState: "feature.txt is missing",
      goalState: "feature.txt exists on main",
      title: "feature",
    });
    const branch = `task/${shortId(task.id)}`;
    yield* commitAndPush(run.workers[0]!.cwd, "feature.txt", branch);
    const number = yield* github.open(branch);
    expect((yield* read(run.orchestrator, task.id)).pullRequest?.number).toBe(number);
    return { ...run, branch, number, taskId: task.id };
  });
}

const reportsThePullRequestOfATaskStoppedFromTheTasksView = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { orchestrator, reports, branch, number, taskId } =
          yield* carryingAPullRequest(remote);
        yield* Effect.promise(() => orchestrator.stop(taskId));
        expect(taskStatus(orchestrator, taskId)).toBe("stopped");
        expect(reports.at(-1)?.details).toMatchObject({ status: "stopped", taskId });
        expect(reports.at(-1)?.text).toContain(`open pull request #${number}`);
        expect(reports.at(-1)?.text).toContain(branch);
      }),
    ),
  );

it(
  "reports the open pull request of a task stopped from the /tasks view to the orchestrator",
  reportsThePullRequestOfATaskStoppedFromTheTasksView,
);

const reportsThePullRequestOfATaskTheWatchdogStops = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        yield* fakeClock();
        const { orchestrator, reports, branch, number, taskId } =
          yield* carryingAPullRequest(remote);
        yield* advance(31 * 60_000);
        expect(taskStatus(orchestrator, taskId)).toBe("stopped");
        expect(reports.at(-1)?.details).toMatchObject({ status: "stopped", taskId });
        expect(reports.at(-1)?.text).toContain(`open pull request #${number}`);
        expect(reports.at(-1)?.text).toContain(branch);
        yield* Effect.promise(() => orchestrator.dispose());
      }),
    ),
  );

it(
  "reports the open pull request of a task the watchdog stops to the orchestrator",
  reportsThePullRequestOfATaskTheWatchdogStops,
);
