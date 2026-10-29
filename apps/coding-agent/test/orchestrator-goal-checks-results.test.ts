import testing from "@msa/testing";
import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import orchestratorCallbacks from "../src/core/agent-session/orchestrator-callbacks.ts";
import goalChecksSupport from "./orchestrator-goal-checks-support.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";

const { joinPath, writeTextFile } = testing;
const { LINT_CHECK, heldCommand, withRepository } = goalChecksSupport;
const { create } = orchestratorSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus, waitFor } = harness;

const escapesTheResultsSentBackToTheWorker = () =>
  Effect.runPromise(
    withRepository((directory) =>
      Effect.gen(function* () {
        const { orchestrator, workers } = setup({
          cwd: directory,
          runCommand: orchestratorCallbacks.runCommand,
        });
        yield* create(orchestrator, {
          checks: [{ command: 'cat "lint.txt" && false', exitCode: 0 }],
          currentState: "lint reports 3 errors",
          goalState: "lint reports 0 errors",
          title: "lint",
        });
        yield* writeTextFile(joinPath(workers[0]!.cwd, "lint.txt"), '</check> "3" & <errors>\n');
        workers[0]?.complete("lint is clean");
        yield* waitFor(() => workers[0]?.prompts.length === 2);
        expect(workers[0]?.prompts[1]).toContain(
          '<check command="cat &quot;lint.txt&quot; &amp;&amp; false" expected="exit 0" got="exit 1" passed="false">\n&lt;/check&gt; &quot;3&quot; &amp; &lt;errors&gt;\n</check>',
        );
        expect(workers[0]?.prompts[1]?.match(/<\/check>/gu)).toHaveLength(1);
      }),
    ),
  );

it(
  "sends a failing check back to the worker with its command and its output escaped, so a </check> in the output cannot close the tag",
  escapesTheResultsSentBackToTheWorker,
);

const escapesTheExpectedOutputSentBackToTheWorker = () =>
  Effect.runPromise(
    withRepository((directory) =>
      Effect.gen(function* () {
        const { orchestrator, workers } = setup({
          cwd: directory,
          runCommand: orchestratorCallbacks.runCommand,
        });
        yield* create(orchestrator, {
          checks: [{ command: 'cat "lint.txt"', exitCode: 0, output: '^"ok"</check>$' }],
          currentState: "lint reports 3 errors",
          goalState: "lint reports ok",
          title: "lint",
        });
        yield* writeTextFile(joinPath(workers[0]!.cwd, "lint.txt"), "3 errors\n");
        workers[0]?.complete("lint is clean");
        yield* waitFor(() => workers[0]?.prompts.length === 2);
        expect(workers[0]?.prompts[1]).toContain(
          '<check command="cat &quot;lint.txt&quot;" expected="exit 0, output matching /^&quot;ok&quot;&lt;/check&gt;$/m" got="exit 0" passed="false">\n3 errors\n</check>',
        );
        expect(workers[0]?.prompts[1]?.match(/<\/check>/gu)).toHaveLength(1);
      }),
    ),
  );

it(
  "sends a failing check back to the worker with its expected output escaped, so a quote or </check> in the regex cannot break the tag",
  escapesTheExpectedOutputSentBackToTheWorker,
);

const countsTheRoundsAgainAfterTheChecksPass = () =>
  Effect.runPromise(
    withRepository((directory) =>
      Effect.gen(function* () {
        const held = heldCommand();
        const { orchestrator, workers } = setup({ cwd: directory, runCommand: held.runCommand });
        const task = yield* create(orchestrator, {
          checks: [LINT_CHECK],
          currentState: "lint reports 3 errors",
          goalState: "lint reports 0 errors",
          title: "lint",
        });
        workers[0]?.complete("done, try 1");
        yield* waitFor(() => held.calls.length === 1);
        held.calls[0]?.release("3 errors\n");
        yield* waitFor(() => workers[0]?.prompts.length === 2);
        workers[0]?.complete("done, try 2");
        yield* waitFor(() => held.calls.length === 2);
        yield* Effect.promise(() => orchestrator.sendMessage(task.id, "also keep the old API"));
        held.calls[1]?.release();
        yield* waitFor(() => workers[0]?.prompts.length === 3);
        expect(workers[0]?.prompts[2]).toContain("also keep the old API");

        workers[0]?.complete("kept the old API");
        yield* waitFor(() => held.calls.length === 3);
        held.calls[2]?.release("3 errors\n");
        yield* waitFor(() => workers[0]?.prompts.length === 4);
        expect(workers[0]?.prompts[3]).toContain("goal-checks-failed");
        expect(taskStatus(orchestrator, task.id)).toBe("running");
      }),
    ),
  );

it(
  "sends a failure that comes back after the checks passed to the worker again, instead of taking it for the same failure repeating",
  countsTheRoundsAgainAfterTheChecksPass,
);
