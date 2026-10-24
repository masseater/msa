import compat from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterAll, afterEach, expect, it, vi } from "vite-plus/test";

import mergeGuard from "../src/core/orchestrator/merge-guard.ts";
import platform from "../src/core/platform/index.ts";
import orchestratorSdkSupport from "./orchestrator-sdk-support.ts";

const { fauxAssistantMessage, fauxToolCall } = compat;
const { joinPath, makeDirectory, pathDelimiter, removePath, runTest, writeTextFile } = testing;
const { createHarness, tempDir } = orchestratorSdkSupport;

afterAll(() => runTest(removePath(tempDir)));
afterEach(() => {
  vi.unstubAllEnvs();
});

const realBin = joinPath(tempDir, "real-bin");
const inheritedPath = platform.readEnv("PATH") ?? "";

const QUERY = 'mutation { mergePullRequest(input: {pullRequestId: "x"}) { clientMutationId } }';

const BYPASSES = [
  'args="pr merge 12 --squash"; gh $args',
  "printf 'gh pr merge 12 --auto --squash\\n' > merge.sh && sh merge.sh",
  `python3 -c 'import subprocess, sys; sys.exit(subprocess.run(["gh", "pr", "merge", "12"]).returncode)'`,
  `printf '%s' '${QUERY}' > merge.graphql && gh api graphql -F query=@merge.graphql`,
  `printf '%s' '${QUERY}' | gh api graphql -F query=@-`,
  "gh alias set --clobber land 'pr merge'",
  'cmd=gh; "$cmd" api -X PUT repos/owner/repo/pulls/12/merge',
];

const ALLOWED = ["gh pr view 12 --json state", "gh pr create --fill"];

function installRealGh() {
  return Effect.gen(function* () {
    yield* makeDirectory(realBin);
    const gh = joinPath(realBin, "gh");
    yield* writeTextFile(gh, '#!/bin/sh\nprintf "real gh:%s\\n" "$*"\n');
    yield* Effect.promise(() => platform.files.chmod({ mode: 0o755, path: gh }));
  });
}

function runInShell(options: { isWorker?: boolean }, commands: readonly string[]) {
  return Effect.gen(function* () {
    yield* installRealGh();
    vi.stubEnv("PATH", `${realBin}${pathDelimiter}${inheritedPath}`);
    const { session, faux } = yield* createHarness(options);
    faux.setResponses([
      fauxAssistantMessage(
        commands.map((command) => fauxToolCall("bash", { command })),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ]);
    yield* Effect.promise(() => session.run.prompting.prompt("merge the pull request"));
    const results = session.messages.flatMap((message) =>
      message.role === "toolResult"
        ? [
            message.content
              .map((part) => (part.type === "text" ? part.text : ""))
              .join("")
              .trim(),
          ]
        : [],
    );
    session.dispose();
    return results;
  });
}

const workerGhRefusesMergesTheCommandTextHides = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const command of BYPASSES) {
        expect(mergeGuard.refusal("bash", { command })).toBeUndefined();
      }
      const results = yield* runInShell({ isWorker: true }, [...BYPASSES, ...ALLOWED]);
      expect(results).toHaveLength(BYPASSES.length + ALLOWED.length);
      for (const output of results.slice(0, BYPASSES.length)) {
        expect(output).toContain(mergeGuard.REASON);
        expect(output).not.toContain("real gh:");
      }
      expect(results.slice(BYPASSES.length)).toEqual([
        expect.stringContaining("real gh:pr view 12 --json state"),
        expect.stringContaining("real gh:pr create --fill"),
      ]);
    }),
  );

it(
  "refuses merges through gh in a worker's shell when a variable, a script, python, a GraphQL file, or an alias hides them from the command text",
  workerGhRefusesMergesTheCommandTextHides,
);

const orchestratorGhIsTheRealOne = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const results = yield* runInShell({}, [BYPASSES[0] ?? ""]);
      expect(results).toEqual([expect.stringContaining("real gh:pr merge 12 --squash")]);
    }),
  );

it("leaves gh alone in the orchestrator's own shell", orchestratorGhIsTheRealOne);
