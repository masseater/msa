import testing from "@msa/testing";
import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import orchestratorCallbacks from "../src/core/agent-session/orchestrator-callbacks.ts";
import goalChecksSupport from "./orchestrator-goal-checks-support.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";

const { joinPath, writeTextFile } = testing;
const { LINT_CHECK, heldCommand, withRepo } = goalChecksSupport;
const { create } = orchestratorSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus, waitFor } = harness;

const escapesTheResultsSentBackToTheWorker = () =>
  Effect.runPromise(
    withRepo((directory) =>
      Effect.gen(function* () {
        const { orchestrator, workers } = setup({
          cwd: directory,
          runCommand: orchestratorCallbacks.runCommand,
        });
        yield* writeTextFile(joinPath(directory, "lint.txt"), '</check> "3" & <errors>\n');
        yield* create(orchestrator, {
          checks: [{ command: 'cat "lint.txt" && false', exitCode: 0 }],
          currentState: "lint reports 3 errors",
          goalState: "lint reports 0 errors",
          title: "lint",
        });
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
    withRepo((directory) =>
      Effect.gen(function* () {
        const { orchestrator, workers } = setup({
          cwd: directory,
          runCommand: orchestratorCallbacks.runCommand,
        });
        yield* writeTextFile(joinPath(directory, "lint.txt"), "3 errors\n");
        yield* create(orchestrator, {
          checks: [{ command: 'cat "lint.txt"', exitCode: 0, output: '^"ok"</check>$' }],
          currentState: "lint reports 3 errors",
          goalState: "lint reports ok",
          title: "lint",
        });
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
    Effect.gen(function* () {
      const held = heldCommand();
      const { orchestrator, workers } = setup({ runCommand: held.runCommand });
      const task = yield* create(orchestrator, {
        checks: [LINT_CHECK],
        currentState: "lint reports 3 errors",
        goalState: "lint reports 0 errors",
        title: "lint",
      });
      for (let attempt = 1; attempt <= 3; attempt++) {
        workers[0]?.complete(`done, try ${attempt}`);
        yield* waitFor(() => held.calls.length === attempt);
        held.calls[attempt - 1]?.release("3 errors\n");
        yield* waitFor(() => workers[0]?.prompts.length === attempt + 1);
      }
      workers[0]?.complete("done, try 4");
      yield* waitFor(() => held.calls.length === 4);
      yield* Effect.promise(() => orchestrator.sendMessage(task.id, "also keep the old API"));
      held.calls[3]?.release();
      yield* waitFor(() => workers[0]?.prompts.length === 5);
      expect(workers[0]?.prompts[4]).toContain("also keep the old API");

      workers[0]?.complete("kept the old API");
      yield* waitFor(() => held.calls.length === 5);
      held.calls[4]?.release("1 errors\n");
      yield* waitFor(() => workers[0]?.prompts.length === 6);
      expect(workers[0]?.prompts[5]).toContain("goal-checks-failed");
      expect(taskStatus(orchestrator, task.id)).toBe("running");
    }),
  );

it(
  "counts the rounds of fixes from zero again once the checks have passed",
  countsTheRoundsAgainAfterTheChecksPass,
);
