import compat from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterAll, expect, it } from "vite-plus/test";

import mergeGuard from "../src/core/orchestrator/merge-guard.ts";
import orchestratorSdkSupport from "./orchestrator-sdk-support.ts";

const { fauxAssistantMessage, fauxToolCall } = compat;
const { removePath, runTest } = testing;
const { createHarness, tempDir } = orchestratorSdkSupport;

afterAll(() => runTest(removePath(tempDir)));

const MERGES = [
  "gh pr merge 12 --squash",
  "gh pr merge 12 --auto --squash",
  "GH_TOKEN=x gh -R owner/repo pr merge 12",
  "git push && gh pr merge --squash --delete-branch",
  "gh api -X PUT repos/owner/repo/pulls/12/merge",
  "gh api graphql -f query='mutation { enablePullRequestAutoMerge(input: {pullRequestId: \"x\"}) { clientMutationId } }'",
];

const refusesEveryMergeInAWorkerShell = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { session, faux } = yield* createHarness({ isWorker: true });
      faux.setResponses([
        fauxAssistantMessage(
          MERGES.map((command) => fauxToolCall("bash", { command })),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("done"),
      ]);

      yield* Effect.promise(() => session.run.prompting.prompt("merge the pull request"));

      const results = session.messages.filter((message) => message.role === "toolResult");
      expect(results).toHaveLength(MERGES.length);
      for (const result of results) {
        expect(result.isError).toBe(true);
        expect(result.content).toEqual([{ text: mergeGuard.REASON, type: "text" }]);
      }
      session.dispose();
    }),
  );

it(
  "refuses gh pr merge and auto-merge in a worker's or reviewer's shell and returns the reason",
  refusesEveryMergeInAWorkerShell,
);

const leavesOtherCommandsAndTheOrchestratorAlone = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const worker = yield* createHarness({ isWorker: true });
      for (const command of [
        "gh pr view 12 --json state,mergeable",
        "gh pr create --fill",
        "gh pr checks 12",
      ]) {
        expect(worker.session.tools.policy.refusal("bash", { command })).toBeUndefined();
      }
      worker.session.dispose();
      const main = yield* createHarness();
      for (const command of MERGES) {
        expect(main.session.tools.policy.refusal("bash", { command })).toBeUndefined();
      }
      main.session.dispose();
    }),
  );

it(
  "lets a worker read and open pull requests and lets the orchestrator's own session merge",
  leavesOtherCommandsAndTheOrchestratorAlone,
);
