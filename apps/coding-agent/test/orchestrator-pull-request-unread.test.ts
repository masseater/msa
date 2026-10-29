import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import replanFormat from "../src/core/orchestrator/replan-format.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import pullRequestSupport from "./pull-request-support.ts";
import worktreeSupport from "./worktree-support.ts";

const { create } = orchestratorSupport;
const { harness } = orchestratorHarness;
const { setup } = harness;
const { read, runCommand, shortId } = worktreeSupport;
const { commitAndPush, withRemote } = pullRequestSupport;

const GH_DOWN = {
  code: 1,
  stderr: "HTTP 502: Bad Gateway (https://api.github.com/graphql)",
  stdout: "",
};

const namesAPullRequestGitHubDidNotAnswerFor = () =>
  Effect.runPromise(
    withRemote(({ github, repository }) =>
      Effect.gen(function* () {
        const { orchestrator, workers } = setup({
          cwd: repository,
          runCommand,
          runGh: github.runGh,
        });
        const task = yield* create(orchestrator, {
          currentState: "g.txt is missing",
          goalState: "g.txt exists on main",
          title: "g",
        });
        const branch = `task/${shortId(task.id)}`;
        yield* commitAndPush(workers[0]!.cwd, "g.txt", branch);
        yield* github.open(branch);
        github.unavailable = GH_DOWN;
        yield* Effect.promise(() => orchestrator.stop(task.id));
        expect((yield* read(orchestrator, task.id)).pullRequest).toBeNull();

        const result = yield* Effect.promise(() =>
          orchestrator.replan({
            reason: "GitHub is down and the first try stalled",
            stop: false,
            tasks: [{ from: [task.id], title: "g again" }],
          }),
        );
        expect(result.handedOver).toEqual([]);
        expect(result.orphaned).toEqual([]);
        expect(result.unread).toEqual([
          { branch, error: expect.stringContaining("HTTP 502") as unknown, taskId: task.id },
        ]);
        expect(replanFormat.formatReplan(result)).toContain(`${task.id} on ${branch}: `);
      }),
    ),
  );

it(
  "names the task and branch whose pull request GitHub did not answer for during a replan instead of dropping it",
  namesAPullRequestGitHubDidNotAnswerFor,
);
