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
  "curl -X PUT -H 'Authorization: Bearer x' https://api.github.com/repos/owner/repo/pulls/12/merge",
  'curl https://api.github.com/graphql -d \'{"query":"mutation { mergePullRequest(input: {}) { clientMutationId } }"}\'',
  "git push\ngh pr merge 12",
  'echo "$(gh pr merge 12)"',
  "bash -lc 'gh pr merge 12 --auto'",
  "timeout 60 gh pr merge 1",
  "nice gh pr merge 1",
  "stdbuf -o0 gh pr merge 1",
  "foo gh pr merge 1",
  "/opt/homebrew/bin/gh pr merge 1 --squash",
  "timeout 60 nice -n 5 gh -R owner/repo api -X PUT repos/owner/repo/pulls/1/merge",
  "timeout 60 bash -c 'gh pr merge 1'",
  "bash <<'EOF'\ngh pr merge 1\nEOF",
];

const MERGE_TOOLS = ["mcp__github__merge_pull_request", "mcp__github__enable_auto_merge"];

const NOT_MERGES = [
  "gh pr view 12 --json state,mergeable",
  "gh pr create --fill",
  "gh pr checks 12",
  "gh pr create --title merge --body 'gh pr merge stays with the harness'",
  'git commit -m "refuse gh pr merge and curl -X PUT /repos/o/r/pulls/1/merge in worker shells"',
  "git commit -F - <<'EOF'\nfeat: refuse gh pr merge\n\ngh api -X PUT repos/o/r/pulls/1/merge\nEOF",
  "cat <<-EOF > notes.md\n\tgh pr merge 12\n\tEOF\ngit add notes.md",
  "rg 'gh pr merge' src",
  "echo 'timeout 60 gh pr merge 1'",
  'git commit -m "run nice gh pr merge 1 in the harness, not here"',
  "cat <<'EOF' | wc -l\ngh pr merge 1\nEOF",
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
  "refuses gh pr merge, auto-merge, and the REST and GraphQL merge calls in a worker's or reviewer's shell and returns the reason",
  refusesEveryMergeInAWorkerShell,
);

const refusesTheGitHubMcpMergeTools = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const worker = yield* createHarness({ isWorker: true });
      for (const name of MERGE_TOOLS) {
        expect(worker.session.tools.policy.refusal(name, { pullNumber: 12 })).toBe(
          mergeGuard.REASON,
        );
      }
      worker.session.dispose();
    }),
  );

it(
  "refuses the GitHub MCP merge and auto-merge tools in a worker's session",
  refusesTheGitHubMcpMergeTools,
);

const leavesOtherCommandsAndTheOrchestratorAlone = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const worker = yield* createHarness({ isWorker: true });
      for (const command of NOT_MERGES) {
        expect(worker.session.tools.policy.refusal("bash", { command })).toBeUndefined();
      }
      expect(
        worker.session.tools.policy.refusal("mcp__github__get_pull_request", {}),
      ).toBeUndefined();
      worker.session.dispose();
      const main = yield* createHarness();
      for (const command of MERGES) {
        expect(main.session.tools.policy.refusal("bash", { command })).toBeUndefined();
      }
      main.session.dispose();
    }),
  );

it(
  "lets a worker read and open pull requests, and write merge commands inside commit messages and heredocs, and lets the orchestrator's own session merge",
  leavesOtherCommandsAndTheOrchestratorAlone,
);
