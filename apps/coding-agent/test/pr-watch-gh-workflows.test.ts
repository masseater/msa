import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type execTypes from "../src/core/exec.types.ts";
import ghModule from "../src/core/pr-watch/gh.ts";

const { ghWorkflowFileArgs, ghWorkflowFilesArgs, makeGh } = ghModule;

const { runTest } = testing;

const execResult = (overrides: Partial<execTypes.ExecResult> = {}): execTypes.ExecResult => ({
  code: 0,
  killed: false,
  stderr: "",
  stdout: "",
  ...overrides,
});

const runGh = (result: execTypes.ExecResult) =>
  makeGh({
    cwd: "/tmp",
    find: () => "/usr/local/bin/gh",
    run: () => Promise.resolve(result),
  });

const readsTimeoutsFromTheWorkflowFilesAtTheHead = () =>
  runTest(
    Effect.gen(function* () {
      const asked: string[][] = [];
      const files: Record<string, string> = {
        ".github/workflows/verify.yml": "name: verify\njobs:\n  test:\n    timeout-minutes: 20\n",
      };
      const gh = makeGh({
        cwd: "/tmp",
        find: () => "/usr/local/bin/gh",
        run: (args) => {
          asked.push(args);
          const path = Object.keys(files).find((file) => args.join(" ").includes(`${file}?ref=`));
          if (path !== undefined) return Promise.resolve(execResult({ stdout: files[path] ?? "" }));
          return Promise.resolve(
            execResult({ stdout: ".github/workflows/verify.yml\n.github/workflows/README.md\n" }),
          );
        },
      });

      const timeouts = yield* gh.timeouts({ number: 12, repository: "masseater/msa" }, "abc123");

      expect(timeouts).toEqual([{ timeoutMs: 20 * 60_000, workflow: "verify" }]);
      expect(asked).toEqual([
        ghWorkflowFilesArgs({ number: 12, repository: "masseater/msa" }, "abc123"),
        ghWorkflowFileArgs(
          { number: 12, repository: "masseater/msa" },
          ".github/workflows/verify.yml",
          "abc123",
        ),
      ]);
      const none = yield* runGh(
        execResult({ code: 1, stderr: "gh: Not Found (HTTP 404)" }),
      ).timeouts({ number: 12 }, "abc123");
      expect(none).toEqual([]);
    }),
  );

describe("gh workflow file reads", () => {
  it(
    "reads timeout-minutes from the workflow files at the head, and none when the repository has no workflows",
    readsTimeoutsFromTheWorkflowFilesAtTheHead,
  );
});
